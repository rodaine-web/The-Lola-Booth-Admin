import AsyncState from "../components/AsyncState.jsx";
import { formatMoney } from "../utils/display.js";
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
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [pendingMerge, setPendingMerge] = useState(null);

  useEffect(() => {
    loadClient();
    loadDuplicates();
  }, [id]);

  async function loadClient() {
    setError("");
    try {
      setClient(await api.get(`/clients/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadDuplicates() {
    try {
      const result = await api.get(`/clients/${id}/duplicates`);
      setDuplicates(result.data || []);
    } catch {
      setDuplicates([]);
    }
  }

  async function mergeDuplicate(sourceClientId) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post(`/clients/${id}/merge`, { sourceClientId });
      setNotice("Duplicate client merged.");
      setPendingMerge(null);
      await loadClient();
      await loadDuplicates();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <main className="page"><AsyncState error={error} noun="client" onRetry={()=>{setError("");loadClient();}}/></main>;
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
      {notice && <div className="toast">{notice}</div>}
      <section className="detail-summary">
        <Metric label="Total Events" value={client.summary?.total_events || 0} />
        <Metric label="Lifetime Value" value={formatMoney(client.summary?.lifetime_value || 0)} />
        <Metric label="Outstanding" value={formatMoney(client.summary?.outstanding_balance || 0)} />
        <Metric label="Type" value={client.client_type} />
      </section>
      <div className="tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
      {tab === "Overview" && <section className="detail-grid"><Panel title="Contact Info"><Field label="Name" value={client.name} /><Field label="Email" value={client.email} /><Field label="Phone" value={client.phone} /><Field label="Company" value={client.company} /><Field label="Preferred Contact" value={client.preferred_contact_method} /></Panel><Panel title="Profile"><Field label="Address" value={[client.address, client.city, client.state, client.zip].filter(Boolean).join(", ") || client.billing_address} /><Field label="Lead Source" value={client.referral_source} /><Field label="Tags" value={client.tags?.join(", ")} /><p className="note-text">{client.notes || "No client notes yet."}</p></Panel><Panel title="Possible Duplicates"><DuplicateList duplicates={duplicates} busy={busy} onMerge={setPendingMerge} /></Panel></section>}
      {tab === "Events" && <DataTable rows={client.events} columns={["event_name", "event_date", "venue_name", "status"]} getRowHref={(row) => `/events/events/${row.id}`} empty="No events yet." />}
      {tab === "Proposals" && <DataTable rows={client.proposals} columns={["proposal_number", "status", "total", "created_at"]} getRowHref={(row) => `/sales/proposals/${row.id}`} empty="No proposals linked." />}
      {tab === "Invoices" && <DataTable rows={client.invoices} columns={["invoice_number", "status", "total", "balance_due"]} getRowHref={(row) => `/finance/invoices/${row.id}`} empty="No invoices linked." />}
      {tab === "Payments" && <DataTable rows={client.payments} columns={["amount", "payment_method", "payment_date", "reference_number"]} empty="No payments recorded." />}
      {tab === "Tasks" && <DataTable rows={client.tasks} columns={["title", "due_date", "priority", "status"]} empty="No tasks linked." />}
      {tab === "Files" && <DataTable rows={client.files} columns={["filename", "category", "visibility", "created_at"]} empty="No files attached." />}
      {tab === "Communications" && <DataTable rows={client.communications} columns={["type", "direction", "subject", "message_summary", "occurred_at"]} empty="No communication logged." />}
      {tab === "Activity" && <Panel title="Activity">{client.activity?.length ? client.activity.map((item) => <p className="note-text" key={item.id}>{item.summary}</p>) : <div className="empty-state">No activity yet.</div>}</Panel>}
      {pendingMerge && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-heading">
              <h2>Merge Duplicate Client</h2>
              <button type="button" onClick={() => setPendingMerge(null)}>Close</button>
            </div>
            <Panel title="Merge Review">
              <Field label="Target" value={client.name} />
              <Field label="Duplicate" value={pendingMerge.name} />
              <Field label="Match" value={pendingMerge.match_reason?.replaceAll("_", " ")} />
              <Field label="Linked Records Moving" value={linkedCountLabel(pendingMerge.linked_counts)} />
              <p className="note-text">The current client stays active. Blank fields may be filled from the duplicate, linked records move here, and the duplicate is archived.</p>
            </Panel>
            <div className="modal-actions">
              <button type="button" onClick={() => setPendingMerge(null)}>Cancel</button>
              <button className="primary-action" disabled={busy} onClick={() => mergeDuplicate(pendingMerge.id)}>Merge Client</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
function Panel({ title, children }) { return <section className="panel"><h2>{title}</h2>{children}</section>; }
function Field({ label, value }) { return <div className="field-row"><span>{label}</span><strong>{value || "—"}</strong></div>; }

function DuplicateList({ duplicates, busy, onMerge }) {
  if (!duplicates.length) return <div className="empty-state">No duplicate clients found.</div>;
  return (
    <div className="stack-list">
      {duplicates.map((item) => (
        <article className="compact-record" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <span>{item.email || item.phone || "No contact"} · {item.match_reason?.replaceAll("_", " ")}</span>
            <small>{item.company || item.client_type} · {linkedCountLabel(item.linked_counts)}</small>
          </div>
          <button className="table-action" disabled={busy} onClick={() => onMerge(item.id)}>Merge</button>
        </article>
      ))}
    </div>
  );
}

function linkedCountLabel(counts = {}) {
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  return `${total} linked record${total === 1 ? "" : "s"}`;
}
