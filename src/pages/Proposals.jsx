import { Archive, Copy, FilePlus2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const statuses = ["", "DRAFT", "READY", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CONVERTED", "ARCHIVED"];

export default function Proposals() {
  const [urlParams, setUrlParams] = useSearchParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const status = urlParams.get("status") || "";
  function setStatus(value) { setUrlParams(current => { const next = new URLSearchParams(current); if (value) next.set("status", value); else next.delete("status"); return next; }); }
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    load();
  }, [search, status, urlParams]);

  async function load() {
    try {
      const query = new URLSearchParams(urlParams);
      query.set("search", search);query.set("pageSize","50");
      if (status) query.set("status", status);
      const result = await api.get(`/proposals?${query}`);
      setRows(result.data || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function rowAction(event, fn, message) {
    event.stopPropagation();
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Sales documents</p>
          <h1>Proposals</h1>
        </div>
        <Link className="primary-action" to="/sales/proposals/new"><FilePlus2 size={16} />New Proposal</Link>
      </div>
      {urlParams.has("funnel") && <p className="note-text">One matching proposal per lead, consistent with the dashboard funnel.</p>}
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <div className="toolbar">
        <label><span>Search</span><div className="input-icon"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Proposal, client, event, package" /></div></label>
        <label><span>Status</span><select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((item) => <option key={item} value={item}>{item || "All statuses"}</option>)}</select></label>
        <label><span>Sort</span><select disabled><option>Newest first</option></select></label>
      </div>
      <DataTable
        rows={rows}
        columns={["proposal_number", "client_name", "event_name", "event_date", "package_name", "total", "status", "created_at", "sent_at", "valid_through", "owner_name"]}
        getRowHref={(row) => `/sales/proposals/${row.id}`}
        empty="No proposals found."
      />
      <div className="row-actions">
        {rows.slice(0, 8).map((row) => (
          <div key={row.id}>
            <span>{row.proposal_number}</span>
            <button onClick={(event) => rowAction(event, () => api.post(`/proposals/${row.id}/duplicate`, {}), "Proposal duplicated.")}><Copy size={14} />Duplicate</button>
            <button onClick={(event) => rowAction(event, () => api.post(`/proposals/${row.id}/archive`, {}), "Proposal archived.")}><Archive size={14} />Archive</button>
          </div>
        ))}
      </div>
    </main>
  );
}
