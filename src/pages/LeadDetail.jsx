import { ArrowLeft, CheckCircle2, CircleDollarSign } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const statuses = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_DRAFT", "PROPOSAL_SENT", "FOLLOW_UP", "WON", "LOST", "ARCHIVED"];
const tabs = ["Overview", "Activity", "Communications", "Proposal", "Tasks", "Files"];

export default function LeadDetail() {
  const { id } = useParams();
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

  useEffect(() => {
    loadLead();
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

  if (error && !lead) return <main className="page"><div className="empty-state">{error}</div></main>;
  if (!lead) return <main className="page"><div className="empty-state">Loading lead...</div></main>;

  const fullName = `${lead.first_name} ${lead.last_name}`;
  const canConvert = lead.status !== "WON" && !lead.converted_event_id;

  return (
    <main className="page">
      <div className="detail-back"><Link to="/sales/leads"><ArrowLeft size={16} />Back to leads</Link></div>
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">Lead profile</p>
          <h1>{fullName}</h1>
          <p className="lede">{lead.event_type} · {formatDate(lead.event_date)} · {lead.city || "Location TBD"}{lead.state ? `, ${lead.state}` : ""}</p>
        </div>
        <div className="detail-actions">
          <select value={lead.status} disabled={busy} onChange={(event) => updateStatus(event.target.value)}>
            {statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
          <button className="primary-action" disabled={!canConvert || busy} onClick={openConvertReview}>
            <CheckCircle2 size={16} />Convert to Booking
          </button>
          <Link className="primary-action" to={`/sales/proposals/new?leadId=${lead.id}`}>Create Proposal</Link>
        </div>
      </div>

      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}

      <section className="detail-summary">
        <Metric label="Preferred Package" value={lead.preferredPackage?.name || "Not selected"} />
        <Metric label="Experience" value={lead.preferredExperience?.name || "Not selected"} />
        <Metric label="Guest Count" value={lead.guest_count || "TBD"} />
        <Metric label="Lead Source" value={friendlySource(lead)} />
        <Metric label="Response SLA" value={responseLabel(lead)} />
      </section>

      <div className="tabs">
        {tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
      </div>

      {tab === "Overview" && (
        <section className="detail-grid">
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
          <Panel title="Event Details">
            <Field label="Date" value={formatDate(lead.event_date)} />
            <Field label="Time" value={`${formatTime(lead.event_start_time)} - ${formatTime(lead.event_end_time)}`} />
            <Field label="Type" value={lead.event_type} />
            <Field label="Venue" value={lead.venue_name} />
            <Field label="Address" value={[lead.venue_address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ")} />
          </Panel>
          <Panel title="Notes">
            <p className="note-text">{lead.message || "No notes yet."}</p>
            <div className="inline-form note-form">
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add an internal note..." />
              <button className="primary-action" onClick={addNote} disabled={!note.trim()}>Add Note</button>
            </div>
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
                  <strong>${Number(addon.price || 0).toLocaleString()}</strong>
                </label>
              ))}
            </div>
            <div className="price-line"><CircleDollarSign size={16} />Selected add-ons: ${selectedTotal.toLocaleString()}</div>
          </Panel>
        </section>
      )}

      {tab === "Activity" && <Panel title="Activity Timeline"><Timeline rows={lead.timeline} /></Panel>}
      {tab === "Communications" && <Panel title="Emails / Communications"><DataTable rows={lead.communications} columns={["type", "direction", "subject", "message_summary", "occurred_at"]} empty="No communication logged yet." /></Panel>}
      {tab === "Proposal" && <Panel title="Proposal"><DataTable rows={lead.proposals} columns={["proposal_number", "status", "notes", "total", "created_at"]} getRowHref={(row) => `/sales/proposals/${row.id}`} empty="No proposal has been created yet." /></Panel>}
      {tab === "Tasks" && <Panel title="Tasks"><DataTable rows={lead.tasks} columns={["title", "due_date", "priority", "status"]} empty="No follow-up tasks yet." /></Panel>}
      {tab === "Files" && <Panel title="Files"><DataTable rows={lead.files} columns={["filename", "category", "storage_provider", "created_at"]} empty="No files attached yet." /></Panel>}
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
    </main>
  );
}

function Metric({ label, value }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

function Panel({ title, children }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function Field({ label, value }) {
  return <div className="field-row"><span>{label}</span><strong>{value || "—"}</strong></div>;
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
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

function formatTime(value) {
  if (!value) return "TBD";
  const [hour, minute] = value.split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
