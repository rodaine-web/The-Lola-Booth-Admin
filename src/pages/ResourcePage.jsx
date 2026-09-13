import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import RelationshipSelect from "../components/RelationshipSelect.jsx";

export default function ResourcePage({ title, endpoint, columns, phase, rowHref, fields = [] }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});

  useEffect(() => {
    setError("");
    api.get(`${endpoint}?search=${encodeURIComponent(search)}`)
      .then((result) => setRows(result.data || []))
      .catch((err) => {
        setRows([]);
        setError(err.message);
      });
  }, [endpoint, search]);

  function openCreate() {
    setForm(Object.fromEntries(fields.map(([name, , type]) => [name, type === "checkbox" ? false : ""])));
    setEditing({ mode: "create" });
    setError("");
    setNotice("");
  }

  function openEdit(row) {
    setForm(Object.fromEntries(fields.map(([name, , type]) => [name, type === "checkbox" ? Boolean(row[name]) : row[name] ?? ""])));
    setEditing({ mode: "edit", id: row.id });
    setError("");
    setNotice("");
  }

  async function saveForm(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value === "" ? null : value]));
    try {
      if (editing.mode === "edit") {
        await api.patch(`${endpoint}/${editing.id}`, payload);
        setNotice(`${title.replace(/s$/, "")} updated.`);
      } else {
        await api.post(endpoint, payload);
        setNotice(`${title.replace(/s$/, "")} created.`);
      }
      setEditing(null);
      const result = await api.get(`${endpoint}?search=${encodeURIComponent(search)}`);
      setRows(result.data || []);
    } catch (err) {
      if (err.message.includes("Possible duplicate")) {
        setError(`${err.message} Open the existing record or continue with a distinct email/phone.`);
      } else {
        setError(err.message);
      }
    }
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
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} />
        <select><option>All statuses</option></select>
        <select><option>Newest first</option></select>
      </div>
      <DataTable rows={rows} columns={columns} getRowHref={rowHref} onEdit={fields.length ? openEdit : null} />
      {editing && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="modal" onSubmit={saveForm}>
            <div className="modal-heading">
              <h2>{editing.mode === "edit" ? "Edit" : "New"} {title.replace(/s$/, "")}</h2>
              <button type="button" onClick={() => setEditing(null)}>Close</button>
            </div>
            <div className="form-grid">
              {fields.map(([name, label, type = "text", config = {}]) => (
                <label key={name} className={type === "textarea" ? "wide" : ""}>
                  {label}
                  {type === "textarea" ? (
                    <textarea value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />
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
              <button className="primary-action">Save</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
