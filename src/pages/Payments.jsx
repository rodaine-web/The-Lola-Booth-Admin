import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

export default function Payments() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { load(); }, [search, provider, status]);

  async function load() {
    try {
      const params = new URLSearchParams({ search, pageSize: "50" });
      if (provider) params.set("provider", provider);
      if (status) params.set("status", status);
      const result = await api.get(`/payments?${params}`);
      setRows(result.data || []);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="page-heading"><div><p className="eyebrow">Finance</p><h1>Payments</h1></div></div>
      {error && <div className="toast error">{error}</div>}
      <div className="toolbar">
        <label><span>Search</span><div className="input-icon"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Invoice, client, reference" /></div></label>
        <label><span>Provider</span><select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">All providers</option><option>MANUAL</option><option>STRIPE</option><option>PAYPAL</option></select></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option>SUCCEEDED</option><option>PROCESSING</option><option>FAILED</option><option>PARTIALLY_REFUNDED</option><option>REFUNDED</option></select></label>
      </div>
      <DataTable rows={rows} columns={["payment_date", "client_name", "event_name", "invoice_number", "provider", "payment_method", "amount", "refunded_amount", "status", "reference_number"]} getRowHref={(row) => `/finance/payments/${row.id}`} empty="No payments found." />
    </main>
  );
}
