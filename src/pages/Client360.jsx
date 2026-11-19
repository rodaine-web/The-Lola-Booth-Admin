// c360-universe-v1
import Client360Agreements from "../components/Client360Agreements.jsx";
import Gallery20ClientPanel from "../components/Gallery20ClientPanel.jsx";
// c360-consolidated-final-v1
// Client 360 Phase 3: inline operational readiness and planning
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck,
  Clock3, CreditCard, FileText, Image as ImageIcon, LayoutDashboard,
  Mail, MapPin, MessageSquare, Phone, ShieldCheck, Users, Wrench,
  AlertCircle, ExternalLink, BriefcaseBusiness
} from "lucide-react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDateOnly, formatMoney } from "../utils/display.js";
import EventPlanningPanel from "../components/EventPlanningPanel.jsx";
import EventCreativePanel from "../components/EventCreativePanel.jsx";
import { Client360Resources, Client360Communications } from "../components/Client360Phase4.jsx";
import Client360SecureFiles from "../components/Client360SecureFiles.jsx";
import { Client360InternalNotes, Client360GallerySummary, Client360ClientVisibility } from "../components/Client360CompletionExtras.jsx";
import Client360FinanceWorkbench, { Client360EngagementPulse } from "../components/Client360FinanceWorkbench.jsx";
import "../styles/client-360.css";

const SECTIONS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "events", label: "Events", icon: CalendarDays },
  { id: "readiness", label: "Event Readiness", icon: CheckCircle2 },
  { id: "planning", label: "Planning & Creative", icon: ClipboardCheck },
  { id: "agreements", label: "Agreements & Signatures", icon: FileText },
  { id: "operations", label: "Staff & Equipment", icon: Wrench },
  { id: "files", label: "Files", icon: FileText },
  { id: "communications", label: "Communications", icon: MessageSquare },
  { id: "finance", label: "Finance", icon: CreditCard },
  { id: "gallery", label: "Gallery", icon: ImageIcon }
];
const done = status => ["COMPLETED", "CANCELLED"].includes(String(status || "").toUpperCase());
const labelStatus = value => String(value || "Not set").replaceAll("_", " ");
const display = value => value === null || value === undefined || value === "" ? "—" : value;
const safeMoney = value => Number.isFinite(Number(value)) ? formatMoney(Number(value)) : "—";

function Panel({ title, description, action, children, className = "" }) {
  return <section className={`c360-panel ${className}`}>
    <div className="c360-panel-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>
    {children}
  </section>;
}
function Empty({ children }) { return <p className="c360-empty">{children}</p>; }
function RowLink({ title, caption, to, status }) {
  return <Link className="c360-row-link" to={to}>
    <span><strong>{title}</strong>{caption && <small>{caption}</small>}</span>
    <span className="c360-row-end">{status && <em>{labelStatus(status)}</em>}<ArrowRight size={16}/></span>
  </Link>;
}
function Metric({ icon: Icon, label, value, sub, onClick }) {
  const contents = <><div className="c360-metric-icon"><Icon size={19}/></div><span>{label}</span><strong>{value}</strong><small>{sub}</small></>;
  return onClick ? <button className="c360-metric" onClick={onClick}>{contents}</button>
    : <div className="c360-metric">{contents}</div>;
}

/** Admin authentication only. No public client session, access token or impersonation. */
export default function Client360() {
  const { id } = useParams();
  const { can } = useAuth();
  const permitted = can("read:sales");
  const eventsAllowed = can("read:events");
  const [client, setClient] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [section, setSection] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // This is admin-authenticated event data, not a public client workspace token.
  const [eventDetail, setEventDetail] = useState(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState("");
  const [eventRefresh, setEventRefresh] = useState(0);
  const [clientRefresh, setClientRefresh] = useState(0); // LOLA_CLIENT360_PORTFOLIO_REFRESH_V1

  useEffect(() => {
    if (!permitted) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    if (clientRefresh === 0) { setClient(null); setSelectedId(""); }
    api.get(`/clients/${id}`).then(result => {
      if (!active) return;
      setClient(result);
      const choices = result.events || [];
      setSelectedId(previous => choices.some(e => e.id === previous) ? previous : (choices.find(e => !done(e.status)) || choices[0])?.id || "");
    }).catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, permitted, clientRefresh]);

  useEffect(() => {
    if (!permitted || !eventsAllowed || !selectedId) {
      setEventDetail(null); setEventError(""); setEventLoading(false);
      return;
    }
    let active = true;
    setEventLoading(true); setEventError(""); setEventDetail(null);
    api.get(`/events/${selectedId}`)
      .then(result => { if (active) setEventDetail(result); })
      .catch(err => { if (active) setEventError(err.message); })
      .finally(() => { if (active) setEventLoading(false); });
    return () => { active = false; };
  }, [selectedId, permitted, eventsAllowed, eventRefresh]);

  const refreshEvent = () => { setEventRefresh(value => value + 1); setClientRefresh(value => value + 1); };
  const allEvents = useMemo(() => client?.events || [], [client]);
  const event = allEvents.find(e => e.id === selectedId);
  const filteredProposals = (client?.proposals || []).filter(x => !event || x.event_id === event.id);
  const filteredInvoices = (client?.invoices || []).filter(x => !event || x.event_id === event.id);
  const filteredTasks = (client?.tasks || []).filter(x => !event || !x.event_id || x.event_id === event.id);
  const filteredFiles = (client?.files || []).filter(x => !event || !x.event_id || x.event_id === event.id);
  const filteredComms = (client?.communications || []).filter(x => !event || !x.event_id || x.event_id === event.id);
  const counts = useMemo(() => {
    const results = {active:0,completed:0,cancelled:0};
    for (const item of allEvents) {
      if (item.status === "CANCELLED") results.cancelled++;
      else if (item.status === "COMPLETED") results.completed++;
      else results.active++;
    }
    return results;
  }, [allEvents]);
  const totalInvoices = filteredInvoices.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const outstanding = filteredInvoices.reduce((sum, item) => sum + (Number(item.balance_due) || 0), 0);

  if (!permitted) return <main className="page"><h1>Access denied</h1><p>You do not have permission to view client records.</p></main>;
  if (loading) return <main className="page" role="status">Opening Client 360…</main>;
  if (error) return <main className="page"><h1>Client workspace unavailable</h1><p role="alert">{error}</p><Link to="/sales/clients">Back to clients</Link></main>;
  if (!client) return null;

  const eventUrl = event && eventsAllowed ? `/events/events/${event.id}` : null;
  const galleryUrl = event && eventsAllowed ? `/operations/galleries?eventId=${encodeURIComponent(event.id)}` : null;
  const openEvent = label => eventUrl && <Link className="c360-inline-action" to={eventUrl}>{label}<ExternalLink size={14}/></Link>;
  const selectedLabel = event?.event_name || "No event selected";
  const readiness = eventDetail?.operations?.readiness;
  const readinessItems = Array.isArray(readiness?.items) ? readiness.items : [];
  const openIssues = readinessItems.filter(item => !["COMPLETE","COMPLETED","READY"].includes(String(item.status || "").toUpperCase()));
  const readinessScore = Number.isFinite(Number(readiness?.score)) ? Math.min(100,Math.max(0,Number(readiness.score))) : null;
  const readinessSection = () => {
    if (!event) return <Empty>Select an event to inspect its readiness.</Empty>;
    if (!eventsAllowed) return <Empty>Your account cannot access event operations.</Empty>;
    if (eventLoading) return <p role="status" className="c360-footnote">Loading event readiness…</p>;
    if (eventError) return <p role="alert" className="c360-error">Event details unavailable: {eventError}</p>;
    if (!readiness) return <Empty>Readiness is not available for this event.</Empty>;
    return <div className="c360-readiness">
      <div className="c360-readiness-summary">
        <div className="c360-readiness-ring" style={{"--readiness": `${readinessScore ?? 0}%`}}>
          <div><strong>{readinessScore === null ? "—" : `${Math.round(readinessScore)}%`}</strong><span>Ready</span></div>
        </div>
        <div className="c360-readiness-counts">
          <strong>{readiness.incomplete ?? openIssues.length} items need attention</strong>
          <span>{readiness.critical ?? 0} critical · {readiness.complete ?? 0} of {readiness.total ?? readinessItems.length} complete</span>
          {readiness.status && <small>{labelStatus(readiness.status)}</small>}
        </div>
      </div>
      <div className="c360-issue-list">
        {openIssues.length ? openIssues.map((item,index) => <div className="c360-issue" key={`${item.category}-${item.label}-${index}`}>
          <span className={String(item.severity).toUpperCase()==="CRITICAL" ? "c360-issue-critical" : "c360-issue-normal"}><AlertCircle size={16}/></span>
          <div><strong>{item.label}</strong><small>{labelStatus(item.category)} · {labelStatus(item.status)}</small></div>
          <button type="button" onClick={() => setSection(/creativ|planning|backdrop|design/i.test(`${item.category} ${item.label}`) ? "planning" : "operations")}>Review <ArrowRight size={14}/></button>
        </div>) : <p className="c360-empty">No outstanding readiness items reported.</p>}
      </div>
    </div>;
  };

  return <main className="page c360-page" aria-labelledby="c360-title">
    <nav className="c360-breadcrumb" aria-label="Breadcrumb"><Link to="/sales/clients"><ArrowLeft size={14}/> Clients</Link><span>/</span><span>Client 360</span></nav>
    <header className="c360-header">
      <div className="c360-identity">
        <div className="c360-avatar" aria-hidden="true">{String(client.name || "C").split(/\s+/).slice(0,2).map(x => x[0]).join("").toUpperCase()}</div>
        <div><span className="c360-overline">CLIENT 360 · ADMIN WORKSPACE</span><h1 id="c360-title">{client.name}</h1><p>{client.company || "Client relationship"}</p></div>
      </div>
      <div className="c360-header-actions">
        <span className="c360-access"><ShieldCheck size={15}/> Staff access · RBAC</span>
        <Link className="c360-action-secondary" to={`/sales/clients/${id}`}>Full client record <ExternalLink size={15}/></Link>
      </div>
    </header>
    <div className="c360-contact-bar">
      {client.email && <a href={`mailto:${client.email}`}><Mail size={15}/>{client.email}</a>}
      {client.phone && <a href={`tel:${String(client.phone).replace(/[^\d+]/g, "")}`}><Phone size={15}/>{client.phone}</a>}
      <span><BriefcaseBusiness size={15}/>{allEvents.length} event{allEvents.length===1?"":"s"} on record</span>
    </div>
    <div className="c360-context">
      <div><span className="c360-context-label">CURRENT EVENT</span>
        <strong>{selectedLabel}</strong>
        {event && <small>{event.event_date ? formatDateOnly(event.event_date) : "Date TBD"} · {display(event.venue_name)} · {labelStatus(event.status)}</small>}
      </div>
      <div className="c360-context-controls">
        {allEvents.length > 0 && <label>Switch event<select value={selectedId} onChange={e => setSelectedId(e.target.value)}>{allEvents.map(e => <option key={e.id} value={e.id}>{e.event_name} · {e.event_date ? formatDateOnly(e.event_date) : "Date TBD"}</option>)}</select></label>}
        {eventUrl && <Link className="c360-action-primary" to={eventUrl}>Manage event <ArrowRight size={16}/></Link>}
      </div>
    </div>
    <div className="c360-layout">
      <nav className="c360-sidebar" aria-label="Client workspace sections">
        {SECTIONS.filter(item => eventsAllowed || !["planning","readiness","operations","gallery"].includes(item.id)).map(item => {
          const Icon = item.icon;
          return <button key={item.id} className={section === item.id ? "c360-nav-active" : ""} onClick={() => setSection(item.id)} aria-current={section === item.id ? "page" : undefined}><Icon size={17}/>{item.label}</button>;
        })}
        <p>Changes to events and records continue to use the existing permission-protected management screens.</p>
      </nav>
      <div className="c360-content">
        {section === "overview" && <>
          <Client360EngagementPulse client={client} event={eventDetail||event} onNavigate={setSection}/>
          {eventsAllowed && <Panel title="Event readiness" description="Live operational checks for the selected event" action={<button className="c360-text-button" onClick={()=>setSection("readiness")}>All readiness checks <ArrowRight size={14}/></button>}>{readinessSection()}</Panel>}
          <div className="c360-metrics">
            <Metric icon={CalendarDays} label="Events on record" value={allEvents.length} sub={`${counts.active} active · ${counts.completed} completed`} onClick={() => setSection("events")}/>
            <Metric icon={ClipboardCheck} label="Tracked tasks" value={filteredTasks.length} sub="Open task records" onClick={() => setSection("events")}/>
            <Metric icon={FileText} label="Files on record" value={filteredFiles.length} sub="View attached files" onClick={() => setSection("files")}/>
            <Metric icon={CreditCard} label="Invoice balance" value={safeMoney(outstanding)} sub={`${filteredInvoices.length} invoices`} onClick={() => setSection("finance")}/>
          </div>
          <div className="c360-dual">
            <Panel title="Booking portfolio" description="Click a segment to inspect its underlying events.">
              {allEvents.length ? <div className="c360-status-chart">
                <div className="c360-ring" style={{"--active": `${counts.active/allEvents.length*100}%`, "--completed": `${(counts.active+counts.completed)/allEvents.length*100}%`}}><div><strong>{allEvents.length}</strong><span>Total events</span></div></div>
                <div className="c360-chart-legend">
                  {[{label:"Active",value:counts.active,cls:"active"},{label:"Completed",value:counts.completed,cls:"completed"},{label:"Cancelled",value:counts.cancelled,cls:"cancelled"}].map(x => <button key={x.label} onClick={() => setSection("events")}><i className={x.cls}/><span>{x.label}</span><strong>{x.value}</strong></button>)}
                </div>
              </div> : <Empty>No events on this client record yet.</Empty>}
            </Panel>
            <Panel title="Event snapshot" description="Current booking details" action={openEvent("Open event")}>
              {event ? <dl className="c360-details"><div><dt>Status</dt><dd>{labelStatus(event.status)}</dd></div><div><dt>Date</dt><dd>{event.event_date ? formatDateOnly(event.event_date) : "TBD"}</dd></div><div><dt>Venue</dt><dd>{display(event.venue_name)}</dd></div><div><dt>Location</dt><dd>{[event.city, event.state].filter(Boolean).join(", ") || "—"}</dd></div></dl> : <Empty>Select a client event to see its details.</Empty>}
            </Panel>
          </div>
          <div className="c360-dual">
            <Panel title="Client activity" description="Recent recorded interactions" action={<button className="c360-text-button" onClick={()=>setSection("communications")}>View communications <ArrowRight size={14}/></button>}>
              {filteredComms.length ? filteredComms.slice(0,4).map((x,i) => <div className="c360-feed-item" key={x.id||i}><span className="c360-feed-dot"/><div><strong>{x.subject || x.type || "Communication"}</strong><small>{x.message_summary || x.occurred_at || "Recorded interaction"}</small></div></div>) : <Empty>No client communications recorded in this view.</Empty>}
            </Panel>
            <Panel title="Quick access" description="Use existing management tools without duplicate records">
              <div className="c360-quick-grid">
                {eventUrl && <Link to={`${eventUrl}?section=planning`}><ClipboardCheck size={19}/> Planning & creative <ArrowRight size={15}/></Link>}
                {eventUrl && <Link to={`${eventUrl}?section=staff`}><Users size={19}/> Staff & equipment <ArrowRight size={15}/></Link>}
                {galleryUrl && <Link to={galleryUrl}><ImageIcon size={19}/> Event gallery <ArrowRight size={15}/></Link>}
                <button onClick={()=>setSection("finance")}><CreditCard size={19}/> Finance <ArrowRight size={15}/></button>
              </div>
            </Panel>
          </div>
        </>}
        {section === "events" && <>
          <div className="c360-metrics c360-metrics-three"><Metric icon={CalendarDays} label="Active events" value={counts.active} sub="Not completed or cancelled"/><Metric icon={CheckCircle2} label="Completed" value={counts.completed} sub="Event history"/><Metric icon={AlertCircle} label="Cancelled" value={counts.cancelled} sub="Event history"/></div>
          <Panel title="All client events" description="Select an event at the top to change the current workspace context.">
            {eventsAllowed && allEvents.length ? allEvents.map(e => <RowLink key={e.id} title={e.event_name} caption={`${e.event_date ? formatDateOnly(e.event_date) : "Date TBD"} · ${e.venue_name || "Venue TBD"}`} status={e.status} to={`/events/events/${e.id}`}/>) : <Empty>{eventsAllowed ? "No events recorded." : "You do not have permission to view events."}</Empty>}
          </Panel>
          <Panel title="Tasks linked to this client" description="Tasks shown from the existing client record">
            {filteredTasks.length ? filteredTasks.slice(0,12).map((t,i)=><div className="c360-data-row" key={t.id||i}><ClipboardCheck size={17}/><span><strong>{t.title}</strong><small>{t.due_date ? formatDateOnly(t.due_date) : "No due date"}</small></span><em>{labelStatus(t.status)}</em></div>) : <Empty>No tasks recorded.</Empty>}
          </Panel>
        </>}
        {section === "readiness" && <Panel title="Event readiness" description="Live operational checks from the existing event operations service" action={openEvent("Full event checklist")}>
          {readinessSection()}
        </Panel>}
        {section === "planning" && <>
          <Panel title="Planning & Creative" description="Manage submissions, backdrop decisions, proof versions and approvals in place" action={openEvent("Full event record")}>
            {!event ? <Empty>Select an event to access planning and creative review.</Empty> : !eventsAllowed ? <Empty>You do not have event access.</Empty> : <div className="c360-inline-workspace">
              <EventPlanningPanel key={`planning-${event.id}`} eventId={event.id} onUpdated={refreshEvent}/>
            </div>}
          </Panel>
          {event && eventsAllowed && <Panel title="Creative proofs & approvals" description="Use the existing permission-checked creative workflow">
            {eventLoading ? <p role="status">Loading event details…</p> : eventError ? <p role="alert" className="c360-error">{eventError}</p> : eventDetail ?
              <div className="c360-inline-workspace"><EventCreativePanel key={`creative-${event.id}`} event={eventDetail} onUpdated={refreshEvent}/></div> :
              <Empty>Creative records are unavailable.</Empty>}
          </Panel>}
        </>}
        {section === "operations" && <Panel title="Staff & Equipment" description="Manage selected-event resources in place" action={openEvent("Full event operations")}>
          {!eventsAllowed ? <Empty>Event operations are restricted.</Empty> : !event ? <Empty>Select an event first.</Empty> : eventLoading ? <p role="status">Loading assignments…</p> : eventError ? <p role="alert" className="c360-error">{eventError}</p> : eventDetail ? <Client360Resources key={event.id} event={eventDetail} onUpdated={refreshEvent}/> : <Empty>Event resources are unavailable.</Empty>}
        </Panel>}
        {section === "files" && <Panel title="Files & Documents" description="Client and event files, with privacy-aware metadata">
          <><Client360SecureFiles records={filteredFiles} selectedEventId={event?.id} clientId={client?.id} onUpdated={refreshEvent}/><Client360ClientVisibility event={event} files={filteredFiles}/></>
        </Panel>}
        {section === "communications" && <Panel title="Communications" description="Event interaction history and internal logging" action={openEvent("Full event record")}>
          {eventLoading ? <p role="status">Loading communications…</p> : eventError ? <p role="alert" className="c360-error">{eventError}</p> : <><Client360Communications key={event?.id||"client"} event={eventDetail||event} records={filteredComms} onUpdated={refreshEvent}/>{eventDetail && <Client360InternalNotes key={`notes-${event?.id}`} event={eventDetail} onUpdated={refreshEvent}/>}</>}
        </Panel>}
        {section === "agreements" && <Client360Agreements client={client} event={event} onUpdated={refreshEvent}/>}
        {section === "finance" && <Panel title="Finance" description="Event and client invoices, proposals and payment records">
          <Client360FinanceWorkbench client={client} event={event} invoices={filteredInvoices} proposals={filteredProposals} payments={(client?.payments||[]).filter(x=>!event||!x.event_id||x.event_id===event.id)} onUpdated={refreshEvent}/>
        </Panel>}
        {section === "gallery" && <Panel title="Event Gallery" description="Album status and secure gallery administration">
          {event ? <Gallery20ClientPanel key={event.id} eventId={event.id}/> : <Empty>Select an event to view its galleries.</Empty>}
        </Panel>}
      </div>
    </div>
  </main>;
}
