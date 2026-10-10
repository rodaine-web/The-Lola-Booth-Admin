import AgreementList from '../components/AgreementList.jsx';
import { useAuth } from "../context/AuthContext.jsx";
import { RecordIdentity, JourneyStrip, DashboardCard, NextBookingAction, RecordActivity, RequestedItems, RecordEditDialog, useRecordJourney } from "../components/RecordDashboard.jsx";
import { formatDateOnly } from "../utils/display.js";
import { TabNavigation, MetricCard as Metric, DetailSection as Panel } from "../components/WorkspaceUI.jsx";
import CustomerPreferences from "../components/CustomerPreferences.jsx";
import AsyncState from "../components/AsyncState.jsx";
import { formatMoney } from "../utils/display.js";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const tabs = ["Overview", "Events", "Proposals", "Agreements", "Invoices", "Payments", "Tasks", "Files", "Communications", "Activity"];

export default function ClientDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [pendingMerge, setPendingMerge] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [eventDetail, setEventDetail] = useState(null);
  const [eventError, setEventError] = useState('');
  const [editing, setEditing] = useState(false);
  const selectedEvent = client?.events?.find(event=>event.id===selectedEventId) || client?.events?.find(event=>!['COMPLETED','CANCELLED'].includes(event.status)) || client?.events?.[0];
  useEffect(() => {
    let current = true;
    setEventDetail(null); setEventError('');
    if (selectedEvent?.id) api.get(`/events/${selectedEvent.id}`).then(value=>{if(current)setEventDetail(value);}).catch(err=>{if(current)setEventError(err.message);});
    return () => {current=false;};
  }, [selectedEvent?.id]);
  const activeEvent = eventDetail?.id === selectedEvent?.id ? eventDetail : selectedEvent;
  const activeProposals = activeEvent ? (client?.proposals || []).filter(proposal=>proposal.event_id===activeEvent.id) : [];
  const journey = useRecordJourney(activeEvent, activeProposals);
  async function saveClient(values) { await api.patch(`/clients/${id}`,values); await loadClient(); setNotice('Client details saved.'); }

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

  if (error && !client) return <main className="page"><AsyncState error={error} noun="client" onRetry={()=>{setError("");loadClient();}}/></main>;
  if (!client) return <main className="page"><div className="empty-state">Loading client...</div></main>;

  return (
    <main className="page record-workspace record-dashboard clientdetail-workspace">
      <div className="detail-back"><Link to="/sales/clients"><ArrowLeft size={16} />Back to clients</Link></div>
      <RecordIdentity name={client.name} status="Client" subtitle={<>{client.email || 'No email'} · {client.phone || 'No phone'} · Client since {client.created_at ? formatDateOnly(client.created_at) : 'not recorded'}</>} event={activeEvent} actions={<><Link className="primary-action" to={`/sales/proposals/new?clientId=${client.id}${activeEvent ? `&eventId=${activeEvent.id}` : ''}`}>Create Proposal</Link><Link to={`/finance/invoices/new?clientId=${client.id}${activeEvent ? `&eventId=${activeEvent.id}` : ''}`}>Create Invoice</Link><button onClick={()=>setTab('Communications')}>Communications</button></>}/>
      {(notice || error) && <div role={error ? 'alert' : 'status'} className={error ? 'toast error' : 'toast'}>{error || notice}</div>}
      {client.events?.length > 1 && <label className="record-event-select">Booking / Event<select value={selectedEvent?.id || ''} onChange={e=>setSelectedEventId(e.target.value)}>{client.events.map(event=><option key={event.id} value={event.id}>{event.event_name} · {event.event_date ? formatDateOnly(event.event_date) : 'Date TBD'}</option>)}</select></label>}
      {eventError && <p role="alert">Event details unavailable: {eventError}</p>}
      {activeEvent ? <JourneyStrip journey={journey}/> : <p className="record-muted">No event linked yet. Create a proposal to start a booking.</p>}
      <section className="record-client-top">
        <NextBookingAction journey={journey} proposalHref={`/sales/proposals/new?clientId=${id}`} onTasks={()=>setTab('Tasks')} onPlanning={activeEvent ? ()=>navigate(`/events/events/${activeEvent.id}?section=planning`) : undefined} onFinance={()=>setTab('Invoices')}/>
        <DashboardCard title="Client Overview" action={<button className="record-text-action" disabled={!can("write:sales")} onClick={()=>setEditing(true)}>Edit</button>}><Field label="Full Name" value={client.name}/><Field label="Email" value={client.email}/><Field label="Phone" value={client.phone}/><Field label="Company" value={client.company}/><Field label="Preferred Contact" value={client.preferred_contact_method}/><Field label="Notes" value={client.notes}/><div className="record-tags">{client.tags?.map(tag=><span key={tag}>{tag}</span>)}</div></DashboardCard>
        <DashboardCard title="Event Summary">{activeEvent ? <><Field label="Date" value={activeEvent.event_date ? formatDateOnly(activeEvent.event_date) : 'TBD'}/><Field label="Time" value={[activeEvent.start_time,activeEvent.end_time].filter(Boolean).join(' – ')}/><Field label="Venue" value={activeEvent.venue_name || 'Venue TBD'}/><Field label="Location" value={[activeEvent.city,activeEvent.state].filter(Boolean).join(', ')}/><Field label="Estimated Guests" value={activeEvent.guest_count}/><Field label="Event Type" value={activeEvent.event_type}/><Link className="record-card-link" to={`/events/events/${activeEvent.id}`}>View full event details →</Link></> : <p className="record-muted">No event linked.</p>}</DashboardCard>
      </section>
      <TabNavigation items={tabs} value={tab} onChange={setTab}/>
      {tab === 'Overview' && <section className="record-client-bottom">
        <DashboardCard title={`Events (${client.events?.length || 0})`}>{client.events?.map(event=><Link className="record-event-card" key={event.id} to={`/events/events/${event.id}`}><strong>{event.event_name}</strong><span>{event.event_date ? formatDateOnly(event.event_date) : 'Date TBD'} · {event.venue_name || 'Venue TBD'}</span><small>{event.status.replaceAll('_',' ')}</small></Link>)}<Link className="record-card-link" to={`/sales/proposals/new?clientId=${id}`}>+ Add another event</Link></DashboardCard>
        <DashboardCard title="Requested Experiences & Add-ons"><RequestedItems experiences={activeEvent?.experiences || []} packages={activeEvent?.packages || []} addons={activeEvent?.addons || []}/>{selectedEvent && !eventDetail && <p className="record-muted">Full selections are available on the event page.</p>}</DashboardCard>
        <RecordActivity rows={eventDetail?.activity || client.activity} onView={()=>setTab('Activity')}/>
      </section>}
      {tab === "Events" && <DataTable rows={client.events} columns={["event_name", "event_date", "venue_name", "status"]} getRowHref={(row) => `/events/events/${row.id}`} empty="No events yet." />}
      {tab === "Proposals" && <DataTable rows={client.proposals} columns={["proposal_number", "status", "total", "created_at"]} getRowHref={(row) => `/sales/proposals/${row.id}`} empty="No proposals linked." />}
      {tab === 'Agreements' && can('read:sales') && <AgreementList clientId={id}/>}
      {tab === "Invoices" && <DataTable rows={client.invoices} columns={["invoice_number", "status", "total", "balance_due"]} getRowHref={(row) => `/finance/invoices/${row.id}`} empty="No invoices linked." />}
      {tab === "Payments" && <DataTable rows={client.payments} columns={["amount", "payment_method", "payment_date", "reference_number"]} empty="No payments recorded." />}
      {tab === "Tasks" && <DataTable rows={client.tasks} columns={["title", "due_date", "priority", "status"]} empty="No tasks linked." />}
      {tab === "Files" && <DataTable rows={client.files} columns={["filename", "category", "visibility", "created_at"]} empty="No files attached." />}
      {tab === "Communications" && <DataTable rows={client.communications} columns={["type", "direction", "subject", "message_summary", "occurred_at"]} empty="No communication logged." />}
      {tab === "Activity" && <Panel title="Activity">{client.activity?.length ? client.activity.map((item) => <p className="note-text" key={item.id}>{item.summary}</p>) : <div className="empty-state">No activity yet.</div>}</Panel>}
      {tab === 'Overview' && <details className="record-advanced"><summary>Client totals, profile and duplicate review</summary><section className="detail-summary"><Metric label="Total Events" value={client.summary?.total_events || 0}/><Metric label="Lifetime Value" value={formatMoney(client.summary?.lifetime_value || 0)}/><Metric label="Outstanding" value={formatMoney(client.summary?.outstanding_balance || 0)}/></section><Panel title="Possible Duplicates"><DuplicateList duplicates={duplicates} busy={busy} onMerge={setPendingMerge}/></Panel><Field label="Address" value={[client.address,client.city,client.state,client.zip].filter(Boolean).join(', ')}/><Field label="Lead Source" value={client.referral_source}/></details>}
      {editing && <RecordEditDialog title="Edit Client" record={client} fields={[{key:'name',label:'Full Name',required:true},{key:'email',label:'Email',type:'email'},{key:'phone',label:'Phone'},{key:'company',label:'Company'},{key:'notes',label:'Notes'}]} onSave={saveClient} onClose={()=>setEditing(false)}/>}
      {tab==="Overview"&&<details className="record-advanced"><summary>Communication preferences & attribution</summary><CustomerPreferences record={client} type="client" onSaved={loadClient}/></details>}
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

function Field({ label, value }) { return <div className="field-row"><span>{label}</span><strong>{value === null || value === undefined || value === "" ? "—" : value}</strong></div>; }

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
          <button className="table-action" disabled={busy} onClick={() => onMerge(item)}>Merge</button>
        </article>
      ))}
    </div>
  );
}

function linkedCountLabel(counts = {}) {
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  return `${total} linked record${total === 1 ? "" : "s"}`;
}
