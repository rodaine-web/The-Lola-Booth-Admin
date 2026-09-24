import { formatDateOnly, formatMoney, formatTimestamp } from "../utils/display.js";
import { ArrowLeft, CheckCircle2, ClipboardList, Download, MessageSquare, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const tabs = ["Overview", "Operations", "Client", "Staff", "Equipment", "Tasks", "Files", "Finance", "Communications", "Activity", "Proposals", "Invoices"];
const eventStatuses = ["INQUIRY", "TENTATIVE", "CONFIRMED", "PREPARING", "READY", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const operationalStatuses = ["PREPARING", "READY", "EN_ROUTE", "ON_SITE", "SETTING_UP", "LIVE", "BREAKDOWN", "COMPLETED", "ISSUE_REPORTED"];

export default function EventDetail() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [staffOptions, setStaffOptions] = useState([]);
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [task, setTask] = useState({ title: "", due_date: "", priority: "NORMAL", status: "OPEN" });
  const [communication, setCommunication] = useState({ type: "PHONE", direction: "OUTBOUND", subject: "", summary: "" });
  const [staffForm, setStaffForm] = useState({ staffProfileId: "", assignmentRole: "ATTENDANT", notes: "", call_time: "", instructions: "", lead_attendant: false });
  const [equipmentId, setEquipmentId] = useState("");
  const [incident, setIncident] = useState({ type: "TECHNICAL", severity: "LOW", quick_issue: "Printer Offline", description: "" });
  const [creative, setCreative] = useState({ approval_status: "NOT_STARTED", backdrop_selection: "", overlay_template: "", special_design_instructions: "" });
  const [contact, setContact] = useState({ role: "DAY_OF_CONTACT", name: "", phone: "", email: "", is_primary: true });
  const [completionReason, setCompletionReason] = useState("");

  useEffect(() => {
    load();
    api.get("/staff?pageSize=100").then((result) => setStaffOptions(result.data || []));
    api.get("/equipment?pageSize=100").then((result) => setEquipmentOptions(result.data || []));
    api.get("/users?pageSize=100").then((result) => setUsers(result.data || [])).catch(() => setUsers([]));
  }, [id]);

  async function load() {
    setError("");
    try {
      setEvent(await api.get(`/events/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function action(fn, success) {
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function downloadRunSheet() {
    await api.download(`/events/${id}/run-sheet.pdf`, `event-run-sheet-${event.event_number || id.slice(0, 8)}.pdf`);
  }

  async function downloadEquipmentLabels() {
    await api.downloadPost("/equipment/qr-labels.pdf", { equipment_ids: event.operations?.equipment?.map((item) => item.equipment_record_id).filter(Boolean) || [] }, `lola-equipment-labels-${event.event_number || id.slice(0, 8)}.pdf`);
  }

  if (error && !event) return <main className="page"><div className="empty-state">{error}</div></main>;
  if (!event) return <main className="page"><div className="empty-state">Loading event...</div></main>;

  return (
    <main className="page">
      <div className="detail-back"><Link to="/events/events"><ArrowLeft size={16} />Back to events</Link></div>
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">{event.event_number || "Event"}</p>
          <h1>{event.event_name}</h1>
          <p className="lede">{event.client_name} · {event.event_type} · {formatDate(event.event_date)} · {event.venue_name || "Venue TBD"}</p>
        </div>
        <div className="detail-actions">
          <select value={event.status} onChange={(e) => action(() => api.patch(`/events/${id}`, { status: e.target.value }), "Event status updated.")}>
            {eventStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
          <Link className="primary-action" to={`/sales/proposals/new?eventId=${event.id}`}>Create Proposal</Link>
          <Link className="primary-action" to={`/finance/invoices/new?eventId=${event.id}&clientId=${event.client_id}`}>Create Invoice</Link>
        </div>
      </div>

      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}

      <section className="detail-summary">
        <Metric label="Payment" value={event.payment_status || "Not booked"} />
        <Metric label="Outstanding" value={formatMoney(event.balance_due || 0)} />
        <Metric label="Experience" value={event.experience_name || "Not selected"} />
        <Metric label="Package" value={event.package_name || "Not selected"} />
        <Metric label="Operational" value={event.operational_status?.replaceAll("_", " ") || "PREPARING"} />
        <Metric label="Readiness" value={`${event.operations?.readiness?.score ?? 0}%`} />
      </section>

      <div className="tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>

      {tab === "Overview" && (
        <section className="detail-grid">
          <Panel title="Event Information">
            <Field label="Date" value={formatDate(event.event_date)} />
            <Field label="Time" value={`${formatTime(event.start_time)} - ${formatTime(event.end_time)}`} />
            <Field label="Setup" value={formatTime(event.setup_time)} />
            <Field label="Breakdown" value={formatTime(event.breakdown_time)} />
            <Field label="Guest Count" value={event.guest_count} />
          </Panel>
          <Panel title="Venue Details">
            <Field label="Venue" value={event.venue_name} />
            <Field label="Address" value={[event.venue_address, event.city, event.state, event.zip].filter(Boolean).join(", ")} />
            <Field label="Parking / Loading" value={event.parking_loading_instructions} />
            <Field label="Power" value={event.power_requirements} />
            <Field label="Wi-Fi" value={event.wifi_notes} />
          </Panel>
          <Panel title="Creative">
            <Field label="Backdrop" value={event.backdrop} />
            <Field label="Print Template" value={event.print_template} />
            <Field label="Add-ons" value={event.addons?.map((addon) => addon.name).join(", ")} />
          </Panel>
          <Panel title="Notes">
            <p className="note-text"><strong>Internal:</strong> {event.internal_notes || "No internal notes."}</p>
            <p className="note-text"><strong>Client:</strong> {event.client_notes || "No client notes."}</p>
          </Panel>
        </section>
      )}

      {tab === "Operations" && (
        <section className="detail-grid">
          <Panel title="Readiness">
            <div className="readiness-score">
              <strong>{event.operations?.readiness?.status}</strong>
              <span>{event.operations?.readiness?.incomplete || 0} items need attention · {event.operations?.readiness?.critical || 0} critical</span>
            </div>
            <div className="readiness-list">
              {event.operations?.readiness?.items?.map((item) => <span key={`${item.category}-${item.label}`} className={`readiness-item ${item.status.toLowerCase()} ${item.severity.toLowerCase()}`}>{item.category}: {item.label} · {item.status.replaceAll("_", " ")}</span>)}
            </div>
            <button className="primary-action" onClick={() => action(() => api.post(`/events/${id}/checklists/instantiate`, {}), "Checklist template applied.")}><ClipboardList size={15} />Apply Checklist Template</button>
          </Panel>
          <Panel title="Operational Status">
            <select value={event.operational_status || "PREPARING"} onChange={(e) => action(() => api.post(`/events/${id}/operations/status`, { status: e.target.value }), "Operational status updated.")}>
              {operationalStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
            <DataTable rows={event.operations?.timeline || []} columns={["label", "value"]} empty="No operational timestamps yet." />
            <div className="button-row">
              <button className="primary-action" onClick={downloadRunSheet}><Download size={15} />Download Run Sheet</button>
              <button onClick={() => action(() => api.post(`/events/${id}/staff-briefs/send`, {}), "Staff brief sent.")}>Send Staff Brief</button>
            </div>
          </Panel>
          <Panel title="Contacts">
            <div className="inline-form">
              <select value={contact.role} onChange={(e) => setContact((c) => ({ ...c, role: e.target.value }))}>{["PRIMARY_CLIENT", "DAY_OF_CONTACT", "PLANNER", "VENUE_CONTACT", "OTHER"].map((role) => <option key={role}>{role}</option>)}</select>
              <input value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} placeholder="Name" />
              <input value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} placeholder="Phone" />
              <button className="primary-action" disabled={!contact.name} onClick={() => action(() => api.post(`/events/${id}/contacts`, contact), "Contact added.")}>Add Contact</button>
            </div>
            <DataTable rows={event.operations?.contacts || []} columns={["role", "name", "phone", "email", "is_primary"]} empty="No day-of contacts." />
          </Panel>
          <Panel title="Checklist">
            {event.operations?.checklists?.map((list) => (
              <div key={list.id} className="checklist-admin-group">
                <h3>{list.name}</h3>
                {list.items.map((item) => (
                  <div className="checklist-admin-item" key={item.id}>
                    <span>{item.title}</span>
                    <select value={item.status} onChange={(e) => action(() => api.patch(`/events/${id}/checklist-items/${item.id}`, { status: e.target.value }), "Checklist item updated.")}>
                      {["PENDING", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED", "BLOCKED"].map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            ))}
          </Panel>
          <Panel title="Creative">
            <select value={creative.approval_status} onChange={(e) => setCreative((c) => ({ ...c, approval_status: e.target.value }))}>{["NOT_STARTED", "IN_PROGRESS", "AWAITING_CLIENT", "APPROVED", "READY"].map((status) => <option key={status}>{status}</option>)}</select>
            <input value={creative.backdrop_selection} onChange={(e) => setCreative((c) => ({ ...c, backdrop_selection: e.target.value }))} placeholder="Backdrop selection" />
            <input value={creative.overlay_template} onChange={(e) => setCreative((c) => ({ ...c, overlay_template: e.target.value }))} placeholder="Overlay/template" />
            <textarea value={creative.special_design_instructions} onChange={(e) => setCreative((c) => ({ ...c, special_design_instructions: e.target.value }))} placeholder="Special design instructions" />
            <button className="primary-action" onClick={() => action(() => api.patch(`/events/${id}/creative`, creative), "Creative updated.")}>Save Creative</button>
          </Panel>
          <Panel title="Incidents">
            <div className="inline-form">
              <select value={incident.quick_issue} onChange={(e) => setIncident((c) => ({ ...c, quick_issue: e.target.value }))}>{["Printer Offline", "Camera Issue", "Lighting Issue", "Internet Issue", "Software/App Issue", "360 Motor Issue", "Audio Guestbook Issue", "Other"].map((item) => <option key={item}>{item}</option>)}</select>
              <select value={incident.severity} onChange={(e) => setIncident((c) => ({ ...c, severity: e.target.value }))}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((item) => <option key={item}>{item}</option>)}</select>
              <input value={incident.description} onChange={(e) => setIncident((c) => ({ ...c, description: e.target.value }))} placeholder="Description" />
              <button className="primary-action" disabled={!incident.description} onClick={() => action(() => api.post(`/events/${id}/incidents`, incident), "Incident reported.")}><TriangleAlert size={15} />Report</button>
            </div>
            <DataTable rows={event.operations?.incidents || []} columns={["severity", "type", "quick_issue", "description", "status"]} empty="No incidents." />
          </Panel>
          <Panel title="Gallery / Completion">
            <Field label="Gallery" value={event.gallery_status} />
            <div className="button-row">
              <button onClick={() => action(() => api.patch(`/events/${id}/gallery`, { status: "PROCESSING" }), "Gallery marked processing.")}>Processing</button>
              <button onClick={() => action(() => api.patch(`/events/${id}/gallery`, { status: "READY", gallery_url: event.gallery_url }), "Gallery marked ready.")}>Ready</button>
              <button onClick={() => action(() => api.post(`/events/${id}/gallery-delivery/send`, { gallery_url: event.gallery_url, send: true }), "Gallery delivery sent.")}>Send Gallery</button>
              <button onClick={() => action(() => api.post(`/events/${id}/gallery-delivery/revoke`, {}), "Gallery delivery revoked.")}>Revoke Delivery</button>
              {event.gallery_url && <a className="inline-link" href={event.gallery_url}>Preview Gallery</a>}
            </div>
            <Field label="Incomplete Checklist" value={event.operations?.completion?.incomplete_checklist_count} />
            <Field label="Equipment Not Returned" value={event.operations?.completion?.equipment_not_returned_count} />
            <Field label="Open Incidents" value={event.operations?.completion?.open_incident_count} />
            <textarea value={completionReason} onChange={(e) => setCompletionReason(e.target.value)} placeholder="Override reason or post-event notes" />
            <button className="primary-action" onClick={() => action(() => api.post(`/events/${id}/operations/complete`, { override_reason: completionReason, completion_notes: completionReason }), "Event completed.")}><CheckCircle2 size={15} />Complete Event</button>
          </Panel>
        </section>
      )}

      {tab === "Client" && <Panel title="Linked Client"><Field label="Name" value={event.client_name} /><Field label="Email" value={event.client_email} /><Field label="Phone" value={event.client_phone} /><Field label="Company" value={event.client_company} /><Link className="inline-link" to={`/sales/clients/${event.client_id}`}>View Client</Link></Panel>}
      {tab === "Staff" && <Panel title="Assigned Staff"><AssignStaff form={staffForm} setForm={setStaffForm} options={staffOptions} onSubmit={() => action(() => api.post(`/events/${id}/staff`, staffForm), "Staff assigned.")} /><DataTable rows={event.operations?.staff || event.staff} columns={["name", "email", "assignment_role", "call_time", "acknowledgement_status", "lead_attendant", "notes"]} empty="No staff assigned." /></Panel>}
      {tab === "Equipment" && <Panel title="Assigned Equipment"><AssignEquipment value={equipmentId} setValue={setEquipmentId} options={equipmentOptions} onSubmit={() => action(() => api.post(`/events/${id}/equipment`, { equipmentId }), "Equipment assigned.")} /><div className="button-row"><button onClick={downloadEquipmentLabels}><Download size={15} />Download QR Labels</button><Link className="inline-link" to={`/scan?eventId=${id}`}>Open Scanner</Link></div><DataTable rows={event.operations?.equipment || event.equipment} columns={["name", "category", "asset_uid", "lifecycle_status", "condition_before", "condition_after"]} empty="No equipment assigned." /></Panel>}
      {tab === "Tasks" && <Panel title="Tasks"><TaskForm users={users} task={task} setTask={setTask} onSubmit={() => action(() => api.post("/tasks", { ...task, event_id: id }), "Task created.")} /><DataTable rows={event.tasks} columns={["title", "due_date", "priority", "status"]} empty="No event tasks yet." /></Panel>}
      {tab === "Files" && <Panel title="Files"><button className="primary-action" disabled>Upload File</button><DataTable rows={event.files} columns={["filename", "category", "visibility", "created_at"]} empty="No files attached." /></Panel>}
      {tab === "Finance" && <Panel title="Finance"><Field label="Booked Total" value={formatMoney(event.booked_total || 0)} /><Field label="Deposit Required" value={formatMoney(event.deposit_required || 0)} /><Field label="Paid" value={formatMoney(event.amount_paid || 0)} /><Field label="Outstanding" value={formatMoney(event.balance_due || 0)} /><DataTable rows={event.payments} columns={["amount", "payment_method", "payment_date", "reference_number"]} empty="No payments recorded." /></Panel>}
      {tab === "Communications" && <Panel title="Communications"><CommunicationForm communication={communication} setCommunication={setCommunication} onSubmit={() => action(() => api.post(`/events/${id}/communications`, communication), "Communication logged.")} /><DataTable rows={event.communications} columns={["type", "direction", "subject", "message_summary", "occurred_at"]} empty="No communication logged." /></Panel>}
      {tab === "Activity" && <Panel title="Activity"><Timeline rows={[...(event.activity || []), ...(event.audit || []).map((row) => ({ ...row, summary: row.action, action: "audit_log" }))]} /></Panel>}
      {tab === "Proposals" && <Panel title="Proposals"><DataTable rows={event.proposals} columns={["proposal_number", "status", "total", "created_at"]} getRowHref={(row) => `/sales/proposals/${row.id}`} empty="No proposals linked." /></Panel>}
      {tab === "Invoices" && <Panel title="Invoices"><DataTable rows={event.invoices} columns={["invoice_number", "status", "total", "balance_due"]} getRowHref={(row) => `/finance/invoices/${row.id}`} empty="No invoices linked." /></Panel>}
    </main>
  );
}

function AssignStaff({ form, setForm, options, onSubmit }) {
  return <div className="inline-form"><select value={form.staffProfileId} onChange={(e) => setForm((c) => ({ ...c, staffProfileId: e.target.value }))}><option value="">Select staff</option>{options.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select><select value={form.assignmentRole} onChange={(e) => setForm((c) => ({ ...c, assignmentRole: e.target.value }))}>{["ATTENDANT", "LEAD_ATTENDANT", "EVENT_MANAGER", "OTHER"].map((role) => <option key={role} value={role}>{role}</option>)}</select><input type="time" value={form.call_time} onChange={(e) => setForm((c) => ({ ...c, call_time: e.target.value }))} /><input value={form.instructions} onChange={(e) => setForm((c) => ({ ...c, instructions: e.target.value }))} placeholder="Instructions" /><input value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} placeholder="Assignment notes" /><label className="check-row"><input type="checkbox" checked={form.lead_attendant} onChange={(e) => setForm((c) => ({ ...c, lead_attendant: e.target.checked }))} />Lead</label><button className="primary-action" onClick={onSubmit} disabled={!form.staffProfileId}><Plus size={15} />Assign</button></div>;
}

function AssignEquipment({ value, setValue, options, onSubmit }) {
  return <div className="inline-form"><select value={value} onChange={(e) => setValue(e.target.value)}><option value="">Select equipment</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select><button className="primary-action" onClick={onSubmit} disabled={!value}><Plus size={15} />Assign</button></div>;
}

function TaskForm({ users, task, setTask, onSubmit }) {
  return <div className="inline-form"><input value={task.title} onChange={(e) => setTask((c) => ({ ...c, title: e.target.value }))} placeholder="Task title" /><input type="date" value={task.due_date} onChange={(e) => setTask((c) => ({ ...c, due_date: e.target.value }))} /><select value={task.priority} onChange={(e) => setTask((c) => ({ ...c, priority: e.target.value }))}>{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}</select><select value={task.assigned_user_id || ""} onChange={(e) => setTask((c) => ({ ...c, assigned_user_id: e.target.value }))}><option value="">Unassigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><button className="primary-action" onClick={onSubmit} disabled={!task.title}><ClipboardList size={15} />Add Task</button></div>;
}

function CommunicationForm({ communication, setCommunication, onSubmit }) {
  return <div className="inline-form"><select value={communication.type} onChange={(e) => setCommunication((c) => ({ ...c, type: e.target.value }))}>{["EMAIL", "PHONE", "SMS", "OTHER"].map((type) => <option key={type}>{type}</option>)}</select><select value={communication.direction} onChange={(e) => setCommunication((c) => ({ ...c, direction: e.target.value }))}>{["INBOUND", "OUTBOUND", "INTERNAL"].map((d) => <option key={d}>{d}</option>)}</select><input value={communication.subject} onChange={(e) => setCommunication((c) => ({ ...c, subject: e.target.value }))} placeholder="Subject" /><input value={communication.summary} onChange={(e) => setCommunication((c) => ({ ...c, summary: e.target.value }))} placeholder="Summary" /><button className="primary-action" onClick={onSubmit} disabled={!communication.summary}><MessageSquare size={15} />Log</button></div>;
}

function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
function Panel({ title, children }) { return <section className="panel"><h2>{title}</h2>{children}</section>; }
function Field({ label, value }) { return <div className="field-row"><span>{label}</span><strong>{value || "—"}</strong></div>; }
function Timeline({ rows }) {
  if (!rows?.length) return <div className="empty-state">No activity yet.</div>;
  return <div className="timeline">{rows.map((row) => <article key={row.id}><span>{formatDate(row.created_at)}</span><strong>{row.summary}</strong><small>{row.action?.replaceAll("_", " ")}</small></article>)}</div>;
}
function formatDate(value) { return value ? formatDateOnly(value) : "TBD"; }
function formatTime(value) {
  if (!value) return "TBD";
  const [hour, minute] = value.split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
