import { formatDateOnly, formatMoney, formatTimestamp } from "../utils/display.js";
import { ArrowLeft, CheckCircle2, Download, Mail, MapPin, Phone, Play, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { clearTokens } from "../api/client.js";
import { listQueuedActions, queueAction, removeQueuedAction, updateQueuedAction } from "../utils/offlineQueue.js";

const statusActions = [
  ["PREPARING", "START TRAVEL", "EN_ROUTE"],
  ["EN_ROUTE", "I'M ON SITE", "ON_SITE"],
  ["ON_SITE", "START SETUP", "SETTING_UP"],
  ["SETTING_UP", "SETUP COMPLETE", "READY"],
  ["READY", "START EVENT", "LIVE"],
  ["LIVE", "END EVENT", "BREAKDOWN"],
  ["BREAKDOWN", "COMPLETE EVENT", "COMPLETED"]
];

export default function MyEvents() {
  const { eventId } = useParams();
  return eventId ? <MyEventDetail eventId={eventId} /> : <MyEventsHome />;
}

function MyEventsShell({ children }) {
  const navigate = useNavigate();
  return (
    <main className="attendant-shell">
      <header className="attendant-header">
        <img src="/brand/LOLA_Primary_Dark_Transparent.png" alt="The LOLA Booth" />
        <nav>
          <Link to="/my-events">My Events</Link>
          <Link to="/my-events#tasks">My Tasks</Link>
          <button onClick={() => { clearTokens(); navigate("/login"); }}>Logout</button>
        </nav>
      </header>
      {children}
    </main>
  );
}

function MyEventsHome() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/my-events").then(setData); }, []);
  if (!data) return <MyEventsShell><div className="empty-state">Loading my events...</div></MyEventsShell>;
  return (
    <MyEventsShell>
      <section className="attendant-hero">
        <p className="eyebrow">Attendant</p>
        <h1>My Events</h1>
        {data.nextEvent && <EventCard event={data.nextEvent} label="Next Event" />}
      </section>
      <section className="attendant-section">
        <h2>Today</h2>
        {data.todaysEvents.length ? data.todaysEvents.map((event) => <EventCard key={event.id} event={event} />) : <p className="note-text">No assigned events today.</p>}
      </section>
      <section className="attendant-section">
        <h2>This Week</h2>
        {data.thisWeek.map((event) => <EventCard key={event.id} event={event} />)}
      </section>
      <section id="tasks" className="attendant-section">
        <h2>My Tasks</h2>
        {data.tasks.map((task) => <article className="attendant-card" key={task.id}><strong>{task.title}</strong><span>{task.due_date || "No due date"} · {task.priority}</span></article>)}
      </section>
      <section className="attendant-section">
        <h2>Needs Attention</h2>
        {data.needsAttention.map((event) => <EventCard key={event.id} event={event} label="Acknowledge assignment" />)}
      </section>
    </MyEventsShell>
  );
}

function EventCard({ event, label }) {
  return (
    <Link className="attendant-card" to={`/my-events/${event.id}`}>
      {label && <small>{label}</small>}
      <strong>{event.event_name}</strong>
      <span>{event.event_type} · {formatDate(event.event_date)}</span>
      <span>{formatTime(event.call_time || event.setup_time)} call · {formatTime(event.start_time)} event</span>
      <span>{event.venue_name || "Venue TBD"}{event.city ? ` · ${event.city}` : ""}</span>
      <em>{event.operational_status?.replaceAll("_", " ")} · {event.equipment_summary}</em>
    </Link>
  );
}

function MyEventDetail({ eventId }) {
  const [ops, setOps] = useState(null);
  const [incident, setIncident] = useState({ type: "TECHNICAL", quick_issue: "Printer Offline", severity: "LOW", description: "" });
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState([]);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    load();
    const cached = localStorage.getItem(`lola-attendant-event-${eventId}`);
    if (cached && !ops) setOps(JSON.parse(cached));
    refreshPending();
    const timer = setInterval(load, 45000);
    return () => clearInterval(timer);
  }, [eventId]);

  useEffect(() => {
    const replay = () => replayPending();
    window.addEventListener("online", replay);
    replay();
    return () => window.removeEventListener("online", replay);
  }, [eventId]);

  async function load() {
    try {
      const result = await api.get(`/my-events/${eventId}`);
      setOps(result);
      localStorage.setItem(`lola-attendant-event-${eventId}`, JSON.stringify(result));
    } catch (err) {
      setError(err.message);
    }
  }

  async function action(fn, success, queued) {
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (err) {
      const record = await queueAction({ ...queued, eventId, endpoint: queued.endpoint || "", status: "PENDING" });
      setPending((items) => [...items, record]);
      setError(`${err.message}. Saved locally for sync.`);
    }
  }

  async function refreshPending() {
    setPending((await listQueuedActions()).filter((item) => item.eventId === eventId && item.status !== "SYNCED"));
  }

  async function replayPending() {
    if (!navigator.onLine) return;
    const rows = (await listQueuedActions()).filter((item) => item.eventId === eventId && ["PENDING", "FAILED"].includes(item.status));
    if (!rows.length) {
      await refreshPending();
      return;
    }
    setSyncing(true);
    for (const row of rows.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const next = { ...row, status: "SYNCING", attempt_count: Number(row.attempt_count || 0) + 1, last_attempt_at: new Date().toISOString() };
      await updateQueuedAction(next);
      try {
        await api.post("/offline-actions/replay", next);
        await removeQueuedAction(row.local_id);
      } catch (err) {
        await updateQueuedAction({ ...next, status: err.message.includes("already") ? "CONFLICT" : "FAILED", last_error: err.message });
      }
    }
    setSyncing(false);
    await refreshPending();
    await load();
  }

  async function downloadRunSheet() {
    try {
      await api.download(`/events/${eventId}/run-sheet.pdf`, `lola-run-sheet-${event.event_number || eventId.slice(0, 8)}.pdf`);
    } catch (err) {
      setError(err.message);
    }
  }

  const next = useMemo(() => statusActions.find(([status]) => status === ops?.event?.operational_status), [ops]);
  if (!ops) return <MyEventsShell><div className="empty-state">Loading event...</div></MyEventsShell>;
  const event = ops.event;
  const dayOf = ops.contacts.find((contact) => contact.role === "DAY_OF_CONTACT" || contact.is_primary) || ops.contacts[0] || { name: event.client_name, phone: event.client_phone, email: event.client_email };

  return (
    <MyEventsShell>
      <Link className="detail-back" to="/my-events"><ArrowLeft size={16} />Back</Link>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <div className={`offline-indicator ${navigator.onLine ? "" : "offline"}`}>
        {!navigator.onLine ? "OFFLINE" : syncing ? "Syncing..." : pending.length ? `${pending.length} changes waiting to sync` : "All changes synced"}
      </div>
      <section className="attendant-hero">
        <p className="eyebrow">{event.operational_status?.replaceAll("_", " ")}</p>
        <h1>{event.event_name}</h1>
        <p>{formatDate(event.event_date)} · {event.venue_name || "Venue TBD"}</p>
        {next && <button className="primary-action thumb-action" onClick={() => action(() => api.post(`/events/${eventId}/operations/status`, { status: next[2] }), `${next[2].replaceAll("_", " ")} saved.`, { actionType: "STATUS_CHANGE", endpoint: `/events/${eventId}/operations/status`, payload: { status: next[2] } })}><Play size={18} />{next[1]}</button>}
        <button className="inline-link button-link" onClick={downloadRunSheet}><Download size={15} />Download Run Sheet</button>
      </section>

      <section className="attendant-section"><h2>Timeline</h2>{ops.timeline.map((item) => <Row key={item.label} label={item.label} value={formatAnyTime(item.value)} />)}</section>
      <section className="attendant-section"><h2>Contact</h2><Row label="Day-of Contact" value={dayOf.name} /><div className="button-row">{dayOf.phone && <a className="primary-action" href={`tel:${dayOf.phone}`}><Phone size={16} />Call</a>}{dayOf.email && <a className="primary-action" href={`mailto:${dayOf.email}`}><Mail size={16} />Email</a>}</div></section>
      <section className="attendant-section"><h2>Venue</h2><Row label="Address" value={[event.venue_address, event.city, event.state].filter(Boolean).join(", ")} /><Row label="Room" value={event.room_name} /><Row label="Parking" value={event.parking_loading_instructions} /><Row label="Load-in" value={event.load_in_instructions || event.access_instructions} /><Row label="Power" value={event.power_requirements} /><Row label="Wi-Fi" value={event.wifi_notes} /><a className="inline-link" href={`https://maps.google.com/?q=${encodeURIComponent([event.venue_name, event.venue_address, event.city, event.state].filter(Boolean).join(" "))}`}><MapPin size={15} />Open in Maps</a></section>
      <section className="attendant-section"><h2>Equipment</h2><Link className="inline-link" to={`/scan?eventId=${eventId}`}>Scan Equipment</Link>{ops.equipment.map((item) => <article className="attendant-card" key={item.id}><strong>{item.name}</strong><span>{item.category} · {item.lifecycle_status}</span><div className="button-row"><button onClick={() => action(() => api.post(`/events/${eventId}/equipment/${item.id}/checkout`, { condition_before: "GOOD" }), "Equipment checked out.", { actionType: "EQUIPMENT_LIFECYCLE", endpoint: `/events/${eventId}/equipment/${item.id}/checkout`, assignmentId: item.id, action: "checkout", payload: { condition_before: "GOOD" } })}>Check Out</button><button onClick={() => action(() => api.post(`/events/${eventId}/equipment/${item.id}/return`, { condition_after: "GOOD" }), "Equipment returned.", { actionType: "EQUIPMENT_LIFECYCLE", endpoint: `/events/${eventId}/equipment/${item.id}/return`, assignmentId: item.id, action: "return", payload: { condition_after: "GOOD" } })}>Return</button></div></article>)}</section>
      <section className="attendant-section"><h2>Checklist</h2>{ops.checklists.flatMap((list) => list.items).map((item) => <button className="checklist-touch" key={item.id} onClick={() => action(() => api.patch(`/events/${eventId}/checklist-items/${item.id}`, { status: item.status === "COMPLETED" ? "PENDING" : "COMPLETED" }), "Checklist updated.", { actionType: "CHECKLIST_UPDATE", endpoint: `/events/${eventId}/checklist-items/${item.id}`, itemId: item.id, payload: { status: item.status === "COMPLETED" ? "PENDING" : "COMPLETED" } })}><CheckCircle2 size={20} /><span>{item.title}</span><strong>{item.status.replaceAll("_", " ")}</strong></button>)}</section>
      <section className="attendant-section"><h2>Notes</h2>{ops.notes.map((item) => <article className="attendant-card" key={item.id}><strong>{item.category}</strong><span>{item.body}</span></article>)}<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Post-event note, client feedback, or setup note" /><button className="primary-action" disabled={!note.trim()} onClick={() => action(() => api.post(`/events/${eventId}/notes`, { category: "POST_EVENT", body: note }), "Note saved.", { actionType: "EVENT_NOTE", endpoint: `/events/${eventId}/notes`, payload: { category: "POST_EVENT", body: note } })}>Save Note</button></section>
      <section className="attendant-section"><h2>Incidents</h2>{ops.incidents.map((item) => <article className="attendant-card" key={item.id}><strong>{item.severity} {item.type}</strong><span>{item.description}</span></article>)}<select value={incident.quick_issue} onChange={(e) => setIncident((c) => ({ ...c, quick_issue: e.target.value }))}>{["Printer Offline", "Camera Issue", "Lighting Issue", "Internet Issue", "Software/App Issue", "360 Motor Issue", "Audio Guestbook Issue", "Other"].map((item) => <option key={item}>{item}</option>)}</select><textarea value={incident.description} onChange={(e) => setIncident((c) => ({ ...c, description: e.target.value }))} placeholder="What happened?" /><button className="primary-action" disabled={!incident.description.trim()} onClick={() => action(() => api.post(`/events/${eventId}/incidents`, incident), "Incident reported.", { actionType: "INCIDENT", endpoint: `/events/${eventId}/incidents`, payload: incident })}><TriangleAlert size={16} />Report Incident</button></section>
      {pending.length > 0 && <section className="attendant-section"><h2>Sync Issues</h2>{pending.map((item) => <article className="attendant-card" key={item.local_id}><strong>{item.actionType}</strong><span>{item.status} · {item.last_error || "Waiting for connection"}</span></article>)}<button onClick={replayPending}><RefreshCw size={16} />Retry Sync</button></section>}
    </MyEventsShell>
  );
}

function Row({ label, value }) { return <div className="field-row"><span>{label}</span><strong>{value || "—"}</strong></div>; }
function formatDate(value) { return value ? formatDateOnly(value) : "TBD"; }
function formatTime(value) {
  if (!value) return "TBD";
  const [hour, minute] = String(value).split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function formatAnyTime(value) {
  if (!value) return "TBD";
  if (String(value).includes("T")) return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return formatTime(value);
}
