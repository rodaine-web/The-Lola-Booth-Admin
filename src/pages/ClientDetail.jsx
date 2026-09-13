import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const tabs = ["Overview", "Events", "Proposals", "Invoices", "Payments", "Tasks", "Files", "Communications", "Activity"];

export default function ClientDetail() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/clients/${id}`).then(setClient).catch((err) => setError(err.message));
  }, [id]);

  if (error) return <main className="page"><div className="empty-state">{error}</div></main>;
  if (!client) return <main className="page"><div className="empty-state">Loading client...</div></main>;

  return (
    <main className="page">
      <div className="detail-back"><Link to="/sales/clients"><ArrowLeft size={16} />Back to clients</Link></div>
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">Client profile</p>
          <h1>{client.name}</h1>
          <p className="lede">{client.email || "No email"} · {client.phone || "No phone"} · {client.company || client.client_type}</p>
        </div>
        <div className="detail-actions">
          <Link className="primary-action" to={`/sales/proposals/new?clientId=${client.id}`}>Create Proposal</Link>
          <Link className="primary-action" to={`/finance/invoices/new?clientId=${client.id}`}>Create Invoice</Link>
        </div>
      </div>
      <section className="detail-summary">
        <Metric label="Total Events" value={client.summary?.total_events || 0} />
        <Metric label="Lifetime Value" value={`$${Number(client.summary?.lifetime_value || 0).toLocaleString()}`} />
        <Metric label="Outstanding" value={`$${Number(client.summary?.outstanding_balance || 0).toLocaleString()}`} />
        <Metric label="Type" value={client.client_type} />
      </section>
      <div className="tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
      {tab === "Overview" && <section className="detail-grid"><Panel title="Contact Info"><Field label="Name" value={client.name} /><Field label="Email" value={client.email} /><Field label="Phone" value={client.phone} /><Field label="Company" value={client.company} /><Field label="Preferred Contact" value={client.preferred_contact_method} /></Panel><Panel title="Profile"><Field label="Address" value={[client.address, client.city, client.state, client.zip].filter(Boolean).join(", ") || client.billing_address} /><Field label="Lead Source" value={client.referral_source} /><Field label="Tags" value={client.tags?.join(", ")} /><p className="note-text">{client.notes || "No client notes yet."}</p></Panel></section>}
      {tab === "Events" && <DataTable rows={client.events} columns={["event_name", "event_date", "venue_name", "status"]} getRowHref={(row) => `/events/events/${row.id}`} empty="No events yet." />}
      {tab === "Proposals" && <DataTable rows={client.proposals} columns={["proposal_number", "status", "total", "created_at"]} getRowHref={(row) => `/sales/proposals/${row.id}`} empty="No proposals linked." />}
      {tab === "Invoices" && <DataTable rows={client.invoices} columns={["invoice_number", "status", "total", "balance_due"]} getRowHref={(row) => `/finance/invoices/${row.id}`} empty="No invoices linked." />}
      {tab === "Payments" && <DataTable rows={client.payments} columns={["amount", "payment_method", "payment_date", "reference_number"]} empty="No payments recorded." />}
      {tab === "Tasks" && <DataTable rows={client.tasks} columns={["title", "due_date", "priority", "status"]} empty="No tasks linked." />}
      {tab === "Files" && <DataTable rows={client.files} columns={["filename", "category", "visibility", "created_at"]} empty="No files attached." />}
      {tab === "Communications" && <DataTable rows={client.communications} columns={["type", "direction", "subject", "message_summary", "occurred_at"]} empty="No communication logged." />}
      {tab === "Activity" && <Panel title="Activity">{client.activity?.length ? client.activity.map((item) => <p className="note-text" key={item.id}>{item.summary}</p>) : <div className="empty-state">No activity yet.</div>}</Panel>}
    </main>
  );
}

function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
function Panel({ title, children }) { return <section className="panel"><h2>{title}</h2>{children}</section>; }
function Field({ label, value }) { return <div className="field-row"><span>{label}</span><strong>{value || "—"}</strong></div>; }
