import {useDialogFocus} from "../utils/use-dialog-focus.js";
import AsyncState from "../components/AsyncState.jsx";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import MediaSelect from "../components/MediaSelect.jsx";
import RelationshipSelect from "../components/RelationshipSelect.jsx";

export default function ResourcePage({ title, endpoint, columns, phase, rowHref, fields = [] }) {
  const [rows, setRows] = useState([]);
  const [loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[saving,setSaving]=useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter,setStatusFilter]=useState(""),[sort,setSort]=useState("created_at"),[overdue,setOverdue]=useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  useDialogFocus(Boolean(editing),()=>setEditing(null));

  useEffect(()=>{setEditing(null);setForm({});setStatusFilter("");},[endpoint]);
  useEffect(() => {
    let active=true; setLoading(true); setError("");
    api.get(`${endpoint}?search=${encodeURIComponent(search)}&status=${statusFilter}&sort_by=${sort}&overdue=${overdue}`)
      .then((result) => {if(active)setRows(result.data || []);})
      .catch((err) => {
        if(active){setRows([]);setError(err.message);}
      }).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  }, [endpoint, search, revision,statusFilter,sort,overdue]);

  function openCreate() {
    setForm(Object.fromEntries(fields.map(([name, , type]) => [name, type === "checkbox" ? false : ""])));
    if (endpoint === "/experiences") setForm(current=>({...current,website_status:"DRAFT",active:true}));
    if (endpoint === "/packages") setForm(current => ({ ...current, pricing_mode: "STARTING", website_status: "DRAFT", currency: "USD", active: true }));
    setEditing({ mode: "create" });
    setError("");
    setNotice("");
  }

  function openEdit(row) {
    setForm(Object.fromEntries(fields.map(([name, , type]) => [name, type === "checkbox" ? Boolean(row[name]) : type === "lines" ? (row[name] || []).join("\n") : row[name] ?? ""])));
    setEditing({ mode: "edit", id: row.id });
    setError("");
    setNotice("");
  }

  async function saveForm(event) {
    event.preventDefault();
    if(saving)return; setSaving(true);
    setError("");
    setNotice("");
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value === "" ? null : value]));
    for(const [name,,type] of fields)if(type==="number"&&payload[name]===null&&name!=="starting_price")delete payload[name];
    for (const [name, , type] of fields) if (type === "lines") payload[name] = String(form[name] || "").split("\n").map(value => value.trim()).filter(Boolean);
    if (endpoint === "/packages" && payload.pricing_mode === "CUSTOM") payload.starting_price = null;
    try {
      if (editing.mode === "edit") {
        await api.patch(`${endpoint}/${editing.id}`, payload);
        setNotice(`${title.replace(/s$/, "")} updated.`);
      } else {
        await api.post(endpoint, payload);
        setNotice(`${title.replace(/s$/, "")} created.`);
      }
      setEditing(null);
      const result = await api.get(`${endpoint}?search=${encodeURIComponent(search)}&status=${statusFilter}&sort_by=${sort}&overdue=${overdue}`);
      setRows(result.data || []);
    } catch (err) {
      if (err.message.includes("Possible duplicate")) {
        setError(`${err.message} Open the existing record or continue with a distinct email/phone.`);
      } else {
        setError(err.message);
      }
    } finally {setSaving(false);}
  }

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{phase || "Operations module"}</p>
          <h1>{title}</h1>
        </div>
        {fields.length > 0 && <button className="primary-action" onClick={openCreate}>New {title.replace(/s$/, "")}</button>}
      </div>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <div className="toolbar">
        <input aria-label="Search records" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} />

        {columns.includes('status')&&(statusFilter||rows.some(r=>r.status))&&<label>Status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All statuses</option>{[...new Set([statusFilter,...rows.map(r=>r.status)].filter(Boolean))].map(status=><option key={status}>{status}</option>)}</select></label>}
        <label>Sort<select value={sort} onChange={e=>setSort(e.target.value)}><option value="created_at">Newest first</option><option value="updated_at">Recently updated</option></select></label>
        {endpoint==='/tasks'&&<label>Overdue only<input type="checkbox" checked={overdue} onChange={e=>setOverdue(e.target.checked)}/></label>}
      </div>
      <AsyncState loading={loading} error={error} onRetry={()=>setRevision(r=>r+1)} noun={title.toLowerCase()}>{!loading&&!error&&<DataTable rows={rows} columns={columns} getRowHref={rowHref} onEdit={fields.length ? openEdit : null} />}</AsyncState>
      {editing && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title+" editor"}>
          <form className="modal" onSubmit={saveForm}>
            <div className="modal-heading">
              <h2>{editing.mode === "edit" ? "Edit" : "New"} {title.replace(/s$/, "")}</h2>
              <button type="button" onClick={() => setEditing(null)}>Close</button>
            </div>
            <div className="form-grid">
              {fields.map(([name, label, type = "text", config = {}]) => (
                <label key={name} className={type === "textarea" ? "wide" : ""}>
                  {label}
                  {name.endsWith("media_id") ? <MediaSelect label={label} value={form[name]} onChange={value=>setForm(current=>({...current,[name]:value}))}/> : type === "textarea" || type === "lines" ? (
                    <textarea aria-label={label} value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />
                  ) : type === "select" ? (
                    <select aria-label={label} value={form[name] || ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}><option value="">Select…</option>{config.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
                  ) : type === "checkbox" ? (
                    <input type="checkbox" checked={Boolean(form[name])} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.checked }))} />
                  ) : type === "relationship" ? (
                    <RelationshipSelect resource={config.resource} value={form[name]} placeholder={label} onChange={(value) => setForm((current) => ({ ...current, [name]: value }))} />
                  ) : (
                    <input type={type} value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />
                  )}
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary-action" disabled={saving}>{saving?"Saving…":"Save"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
