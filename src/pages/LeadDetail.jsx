import { useAuth } from "../context/AuthContext.jsx";
import { RecordIdentity, JourneyStrip, DashboardCard, NextBookingAction, RecordActivity, RequestedItems, RecordEditDialog, useRecordJourney } from "../components/RecordDashboard.jsx";
import { TabNavigation, MetricCard as Metric, DetailSection as Panel } from "../components/WorkspaceUI.jsx";
import RelationshipSelect from "../components/RelationshipSelect.jsx";
import CustomerPreferences from "../components/CustomerPreferences.jsx";
import AsyncState from "../components/AsyncState.jsx";
import { formatDateOnly, formatMoney, formatTimestamp } from "../utils/display.js";
import { ArrowLeft, CheckCircle2, CircleDollarSign } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const statuses = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_DRAFT", "PROPOSAL_SENT", "FOLLOW_UP", "WON", "LOST", "ARCHIVED"];
const tabs = ["Overview", "Activity", "Communications", "Proposals", "Invoices", "Tasks", "Files"];

export default function LeadDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [addons, setAddons] = useState([]);
  const [selectedAddons, setSelectedAddons] = useState([]);
  const [tab, setTab] = useState("Overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [convertPreview, setConvertPreview] = useState(null);
  const [note, setNote] = useState("");
  const [duplicates, setDuplicates] = useState([]);
  const [pendingMerge, setPendingMerge] = useState(null);
  const [editing, setEditing] = useState(false);
  const [bookingEvent, setBookingEvent] = useState(null);
  const bookingEventId = lead?.converted_event_id || lead?.proposals?.find(proposal=>["ACCEPTED","CONVERTED"].includes(proposal.status))?.event_id;
  useEffect(() => {
    let current = true;
    setBookingEvent(null);
    if (bookingEventId) api.get(`/events/${bookingEventId}`).then(value => { if (current) setBookingEvent(value); }).catch(() => {});
    return () => { current = false; };
  }, [bookingEventId]);
  const journey = useRecordJourney(bookingEvent, lead?.proposals, lead);

  useEffect(() => {
    loadLead();
    loadDuplicates();
    api.get("/addons?pageSize=100").then((result) => setAddons(result.data || [])).catch(() => setAddons([]));
  }, [id]);

  async function loadLead() {
    setError("");
    try {
      setLead(await api.get(`/leads/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadDuplicates() {
    try {
      const result = await api.get(`/leads/${id}/duplicates`);
      setDuplicates(result.data || []);
    } catch {
      setDuplicates([]);
    }
  }

  async function mergeDuplicate(sourceLeadId) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post(`/leads/${id}/merge`, { sourceLeadId });
      setNotice("Duplicate lead merged.");
      setPendingMerge(null);
      await loadLead();
      await loadDuplicates();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateDetails(patch) {
 if(busy)return;setBusy(true);setError('');try {const updated=await api.patch(`/leads/${id}`,patch);setLead(current=>({...current,...updated}));setNotice('Lead details saved.');}catch(e){setError(e.message);}finally{setBusy(false);}
 }

 async function updateStatus(status) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await api.patch(`/leads/${id}`, { status });
      setLead((current) => ({ ...current, ...updated }));
      setNotice(`Lead moved to ${status.replaceAll("_", " ")}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openConvertReview() {
    setError("");
    try {
      setConvertPreview(await api.get(`/leads/${id}/convert-preview`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function convertLead() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.post(`/leads/${id}/convert`, { addonIds: selectedAddons });
      setNotice("Lead converted to a booking.");
      setConvertPreview(null);
      navigate(`/events/events/${result.event.id}`, { state: { convertedEventId: result.event.id } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setError("");
    setNotice("");
    try {
      await api.post(`/leads/${id}/notes`, { content: note });
      setNote("");
      setNotice("Note added.");
      await loadLead();
    } catch (err) {
      setError(err.message);
    }
  }

  const selectedTotal = useMemo(() => {
    return addons
      .filter((addon) => selectedAddons.includes(addon.id))
      .reduce((sum, addon) => sum + Number(addon.price || 0), 0);
  }, [addons, selectedAddons]);

  if (error && !lead) return <main className="page record-detail-redesign"><AsyncState error={error} noun="lead" onRetry={()=>{setError("");loadLead();}}/></main>;
  if (!lead) return <main className="page"><div className="empty-state">Loading lead...</div></main>;

  const fullName = `${lead.first_name} ${lead.last_name}`;
  const canConvert = lead.status !== "WON" && !lead.converted_event_id;

  return (
    <main className="page record-workspace record-dashboard leaddetail-workspace">
      <div className="detail-back"><Link to="/sales/leads"><ArrowLeft size={16} />Back to leads</Link></div>
      <RecordIdentity name={fullName} status={lead.status === 'NEW' ? 'New Inquiry' : lead.status} subtitle={<>{lead.email} · {lead.phone || 'No phone'}</>} event={{...lead,start_time:lead.event_start_time,end_time:lead.event_end_time}} actions={<><Link className="primary-action" to={`/sales/proposals/new?leadId=${lead.id}`}>Create Proposal</Link><button onClick={()=>setTab('Communications')}>Communications</button><details className="record-more"><summary aria-label="More lead actions">•••</summary><button disabled={!canConvert || busy} onClick={openConvertReview}>Review Booking Conversion</button></details></>}/>
      <JourneyStrip journey={journey} lead />

      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}

      <div className="record-lead-layout">
        <aside className="record-column">
          <NextBookingAction journey={journey} proposalHref={`/sales/proposals/new?leadId=${lead.id}`} onTasks={()=>setTab('Tasks')}/>
          <DashboardCard title="Lead Information" action={<button className="record-text-action" disabled={!can("write:sales")} onClick={()=>setEditing(true)}>Edit</button>}><Field label="Name" value={fullName}/><Field label="Email" value={lead.email}/><Field label="Phone" value={lead.phone}/><Field label="Source" value={friendlySource(lead)}/><Field label="Received" value={formatDateTime(lead.received_at || lead.created_at)}/><Field label="Assigned To" value={lead.assigned_user_name || (lead.assigned_user_id ? "Assigned · see assignment details" : "Unassigned")}/><Field label="Tags" value={lead.tags?.join(', ')}/></DashboardCard>
          <DashboardCard title="Internal Notes"><textarea value={note} onChange={e=>setNote(e.target.value)} aria-label="Internal note" placeholder="Add an internal note about this lead…"/><button onClick={addNote} disabled={!note.trim()}>Add Note</button></DashboardCard>
        </aside>
        <div className="record-column">
          <TabNavigation items={tabs} value={tab} onChange={setTab} />
          {tab === 'Overview' && <>
            <DashboardCard title="Event Details"><Field label="Date" value={formatDate(lead.event_date)}/><Field label="Time" value={`${formatTime(lead.event_start_time)} – ${formatTime(lead.event_end_time)}`}/><Field label="Venue" value={lead.venue_name || 'Venue TBD'}/><Field label="Address" value={[lead.venue_address,lead.city,lead.state].filter(Boolean).join(', ')}/><Field label="Event Type" value={lead.event_type}/><Field label="Estimated Guests" value={lead.guest_count}/><h3>Notes from Inquiry</h3><p className="record-inquiry-note">{lead.message || 'No inquiry notes recorded.'}</p></DashboardCard>
            <DashboardCard title="Requested Experiences & Add-ons"><RequestedItems experiences={lead.source_details?.bookingInquiry?.selections || (lead.preferredExperience ? [lead.preferredExperience] : [])} packages={lead.source_details?.bookingInquiry ? [] : (lead.preferredPackage ? [lead.preferredPackage] : [])} addons={lead.source_details?.bookingInquiry?.addons || []}/></DashboardCard>
          </>}
{tab === "Overview" && <details className="lead-advanced-details"><summary>Assignment, source, preferences & conversion details</summary>      <section className="detail-summary">
        <Metric label="Preferred Package" value={lead.preferredPackage?.name || "Not selected"} />
        <Metric label="Experience" value={lead.preferredExperience?.name || "Not selected"} />
        <Metric label="Guest Count" value={lead.guest_count || "TBD"} />
        <Metric label="Lead Source" value={friendlySource(lead)} />
        <Metric label="Response SLA" value={responseLabel(lead)} />
      </section>

<section className="detail-grid">          <Panel title="Assignment and experience"><RelationshipSelect resource="users" placeholder="Lead owner" value={lead.assigned_user_id} disabled={busy} onChange={value=>updateDetails({assigned_user_id:value})}/><RelationshipSelect resource="packages" placeholder="Preferred package" value={lead.preferred_package_id} disabled={busy} onChange={value=>updateDetails({preferred_package_id:value})}/></Panel>
          <Panel title="Client Details">
            <Field label="Name" value={fullName} />
            <Field label="Email" value={lead.email} />
            <Field label="Phone" value={lead.phone} />
            <Field label="Referral Source" value={lead.referral_source} />
          </Panel>
          <Panel title="Source Details">
            <Field label="Source" value={friendlySource(lead)} />
            <Field label="Campaign" value={lead.campaign_name || lead.campaign || lead.utm_campaign} />
            <Field label="Form" value={lead.form_name || lead.form_id} />
            <Field label="Received" value={formatDateTime(lead.received_at || lead.created_at)} />
            <Field label="Duplicate Status" value={lead.duplicate_status?.replaceAll("_", " ")} />
            <Field label="UTM Source" value={lead.utm_source} />
            <details className="source-details">
              <summary>Advanced raw IDs</summary>
              <Field label="Provider" value={lead.provider} />
              <Field label="External Lead ID" value={lead.external_lead_id} />
              <Field label="Campaign ID" value={lead.campaign_id} />
              <Field label="Ad Set ID" value={lead.ad_set_id} />
              <Field label="Ad ID" value={lead.ad_id} />
            </details>
          </Panel>
          <Panel title="Possible Duplicates">
            <DuplicateList duplicates={duplicates} busy={busy} onMerge={setPendingMerge} />
          </Panel>
          <Panel title="Conversion Pricing">
            <p className="note-text">Add-ons selected here are priced server-side and attached to the booking during conversion.</p>
            <div className="addon-list">
              {addons.map((addon) => (
                <label key={addon.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedAddons.includes(addon.id)}
                    onChange={(event) => {
                      setSelectedAddons((current) => event.target.checked ? [...current, addon.id] : current.filter((item) => item !== addon.id));
                    }}
                  />
                  <span>{addon.name}</span>
                  <strong>{formatMoney(addon.price || 0)}</strong>
                </label>
              ))}
            </div>
            <div className="price-line"><CircleDollarSign size={16} />Selected add-ons: ${selectedTotal.toLocaleString()}</div>
          </Panel></section></details>}

      {tab === "Activity" && <Panel title="Activity Timeline"><Timeline rows={lead.timeline} /></Panel>}
      {tab === "Communications" && <Panel title="Emails / Communications"><DataTable rows={lead.communications} columns={["type", "direction", "subject", "message_summary", "occurred_at"]} empty="No communication logged yet." /></Panel>}
      {tab === "Proposals" && <Panel title="Proposal"><DataTable rows={lead.proposals} columns={["proposal_number", "status", "notes", "total", "created_at"]} getRowHref={(row) => `/sales/proposals/${row.id}`} empty="No proposal has been created yet." /></Panel>}
      {tab === "Invoices" && <Panel title="Invoices"><DataTable rows={bookingEvent?.invoices || []} columns={["invoice_number","status","total","balance_due"]} getRowHref={row=>`/finance/invoices/${row.id}`} empty="No event invoices available. Review the linked proposal for its invoice handoff."/></Panel>}
      {tab === "Tasks" && <Panel title="Tasks"><DataTable rows={lead.tasks} columns={["title", "due_date", "priority", "status"]} empty="No follow-up tasks yet." /></Panel>}
      {tab === "Files" && <Panel title="Files"><DataTable rows={lead.files} columns={["filename", "category", "storage_provider", "created_at"]} empty="No files attached yet." /></Panel>}
        </div>
        <aside className="record-column">
          <DashboardCard title="Lead Status"><label className="record-input-label">Status<select aria-label="Lead status" value={lead.status} disabled={busy || !can("write:sales")} onChange={e=>updateStatus(e.target.value)}>{statuses.map(status=><option key={status} value={status}>{status === 'NEW' ? 'New Inquiry' : status.toLowerCase().replaceAll('_',' ')}</option>)}</select></label><Field label="Preferred Package" value={lead.preferredPackage?.name}/><Field label="Response SLA" value={responseLabel(lead)}/></DashboardCard>
          <DashboardCard title="Quick Actions"><div className="record-quick-actions"><button onClick={()=>setTab('Communications')}>View Communications</button><Link to={`/sales/proposals/new?leadId=${lead.id}`}>Create Proposal</Link><Link to="/operations/tasks">Create Task / Schedule Call</Link><button className="record-danger" disabled={busy || !can('write:sales') || ['WON','LOST','ARCHIVED'].includes(lead.status)} onClick={()=>updateStatus('LOST')}>Mark as Lost</button></div></DashboardCard>
          <RecordActivity rows={lead.timeline} onView={()=>setTab('Activity')}/>
        </aside>
      </div>
      {editing && <RecordEditDialog title="Edit Lead" record={lead} fields={[{key:'first_name',label:'First Name',required:true},{key:'last_name',label:'Last Name',required:true},{key:'email',label:'Email',type:'email',required:true},{key:'phone',label:'Phone'},{key:'venue_name',label:'Venue'},{key:'city',label:'City'},{key:'state',label:'State'}]} onSave={async values=>{await api.patch(`/leads/${id}`,values);await loadLead();setNotice('Lead details saved.');}} onClose={()=>setEditing(false)}/>}
      {convertPreview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-heading">
              <h2>Review Conversion</h2>
              <button type="button" onClick={() => setConvertPreview(null)}>Close</button>
            </div>
            <section className="detail-grid">
              <Panel title="Client">
                <Field label="Action" value={convertPreview.clientAction === "REUSE_EXISTING" ? "Reuse existing client" : "Create new client"} />
                <Field label="Name" value={convertPreview.existingClient?.name || `${lead.first_name} ${lead.last_name}`} />
                <Field label="Email" value={convertPreview.existingClient?.email || lead.email} />
              </Panel>
              <Panel title="Event">
                <Field label="Event" value={convertPreview.eventPreview.event_name} />
                <Field label="Date" value={formatDate(convertPreview.eventPreview.event_date)} />
                <Field label="Venue" value={convertPreview.eventPreview.venue_name} />
                <Field label="Package" value={convertPreview.eventPreview.package_name} />
                <Field label="Experience" value={convertPreview.eventPreview.experience_name} />
              </Panel>
            </section>
            <div className="modal-actions">
              <button type="button" onClick={() => setConvertPreview(null)}>Cancel</button>
              <button className="primary-action" disabled={busy} onClick={convertLead}>Confirm Conversion</button>
            </div>
          </div>
        </div>
      )}
      {tab==="Overview"&&<details className="record-advanced"><summary>Communication preferences & attribution</summary><CustomerPreferences record={lead} type="lead" onSaved={loadLead}/></details>}
      {pendingMerge && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-heading">
              <h2>Merge Duplicate Lead</h2>
              <button type="button" onClick={() => setPendingMerge(null)}>Close</button>
            </div>
            <Panel title="Merge Review">
              <Field label="Target" value={fullName} />
              <Field label="Duplicate" value={`${pendingMerge.first_name} ${pendingMerge.last_name}`} />
              <Field label="Match" value={pendingMerge.match_reason?.replaceAll("_", " ")} />
              <Field label="Linked Records Moving" value={linkedCountLabel(pendingMerge.linked_counts)} />
              <p className="note-text">The current lead stays active. Blank fields may be filled from the duplicate, linked records move here, and the duplicate is archived.</p>
            </Panel>
            <div className="modal-actions">
              <button type="button" onClick={() => setPendingMerge(null)}>Cancel</button>
              <button className="primary-action" disabled={busy} onClick={() => mergeDuplicate(pendingMerge.id)}>Merge Lead</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function DuplicateList({ duplicates, busy, onMerge }) {
  if (!duplicates.length) return <div className="empty-state">No duplicate leads found.</div>;
  return (
    <div className="stack-list">
      {duplicates.map((item) => (
        <article className="compact-record" key={item.id}>
          <div>
            <strong>{item.first_name} {item.last_name}</strong>
            <span>{item.email || item.phone || "No contact"} · {item.match_reason?.replaceAll("_", " ")}</span>
            <small>{item.event_type || "Event TBD"} · {formatDate(item.event_date)} · {linkedCountLabel(item.linked_counts)}</small>
          </div>
          <button className="table-action" disabled={busy} onClick={() => onMerge(item)}>Merge</button>
        </article>
      ))}
    </div>
  );
}





function Field({ label, value }) {
  return <div className="field-row"><span>{label}</span><strong>{value === null || value === undefined || value === "" ? "—" : value}</strong></div>;
}

function Timeline({ rows }) {
  if (!rows?.length) return <div className="empty-state">No activity yet.</div>;
  return (
    <div className="timeline">
      {rows.map((row) => (
        <article key={row.id}>
          <span>{formatDate(row.created_at)}</span>
          <strong>{row.summary}</strong>
          <small>{row.action.replaceAll("_", " ")}</small>
        </article>
      ))}
    </div>
  );
}

function formatDate(value) {
  if (!value) return "TBD";
  return formatDateOnly(value);
}

function formatDateTime(value) {
  if (!value) return "TBD";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function friendlySource(lead) {
  if (lead.source_subtype === "INSTAGRAM") return "Instagram";
  if (lead.source_subtype === "FACEBOOK") return "Facebook";
  if (lead.provider === "TIKTOK") return "TikTok";
  if (lead.provider === "LINKEDIN") return "LinkedIn";
  if (lead.provider === "WEBSITE" || lead.lead_source === "WEBSITE") return "Website";
  return lead.lead_source || "Manual";
}

function responseLabel(lead) {
  if (lead.response_time_minutes !== null && lead.response_time_minutes !== undefined) return `Responded in ${lead.response_time_minutes} min`;
  const start = new Date(lead.received_at || lead.created_at).getTime();
  if (!start) return "Not started";
  const minutes = Math.max(0, Math.floor((Date.now() - start) / 60000));
  if (minutes < 60) return `Waiting ${minutes} min`;
  return `Waiting ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function linkedCountLabel(counts = {}) {
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  return `${total} linked record${total === 1 ? "" : "s"}`;
}

function formatTime(value) {
  if (!value) return "TBD";
  const [hour, minute] = value.split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
