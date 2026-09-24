import { FilePlus2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const statuses = ["", "DRAFT", "SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID", "REFUNDED"];

export default function Invoices() {
  const [urlParams, setUrlParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const status = urlParams.get("status") || "";
  function setStatus(value) { setUrlParams(current => { const next = new URLSearchParams(current); if (value) next.set("status", value); else next.delete("status"); return next; }); }
  const [error, setError] = useState("");

  useEffect(() => { load(); }, [search, status, urlParams]);

  async function load() {
    try {
      const query = new URLSearchParams(urlParams);
      query.set("search", search);query.set("pageSize","50");
      if (status) query.set("status", status);
      const result = await api.get(`/invoices?${query}`);
      setRows(result.data || []);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Finance documents</p>
          <h1>Invoices</h1>
        </div>
        <Link className="primary-action" to="/finance/invoices/new"><FilePlus2 size={16} />New Invoice</Link>
      </div>
      {error && <div className="toast error">{error}</div>}
      <div className="toolbar">
        <label><span>Search</span><div className="input-icon"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Invoice, client, event" /></div></label>
        <label><span>Status</span><select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((item) => <option key={item} value={item}>{item || "All statuses"}</option>)}</select></label>
        <label><span>Sort</span><select aria-label="Sort" value={urlParams.get("sort_by")||"created_at"} onChange={e=>setUrlParams(current=>{const next=new URLSearchParams(current);next.set("sort_by",e.target.value);return next;})}><option value="created_at">Newest first</option><option value="total">Highest total</option><option value="event_date">Event date</option></select></label>
      </div>
      <DataTable rows={rows} columns={["invoice_number", "client_name", "event_name", "event_date", "proposal_number", "total", "amount_outstanding", "status", "due_date"]} getRowHref={(row) => `/finance/invoices/${row.id}`} empty="No invoices found." />
    </main>
  );
}
