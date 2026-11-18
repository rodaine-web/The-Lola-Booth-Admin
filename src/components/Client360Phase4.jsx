import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { CheckCircle2, RefreshCw, UserRound, Boxes, FileText, MessageSquare } from "lucide-react";

const human = (v) => String(v || "Not set").replaceAll("_", " ");
const valueList = (v) => Array.isArray(v) ? v : [];

function Card({ title, description, children }) {
  return <section className="c360-p4-card"><div className="c360-p4-heading"><h3>{title}</h3><p>{description}</p></div>{children}</section>;
}
function Notice({ error, notice }) {
  return <>{error && <p role="alert" className="c360-p4-error">{error}</p>}{notice && <p role="status" className="c360-p4-notice"><CheckCircle2 size={16} /> {notice}</p>}</>;
}
function Empty({ children }) { return <p className="c360-p4-empty">{children}</p>; }

export function Client360Resources({ event, onUpdated }) {
  const { can } = useAuth();
  const allowed = can("read:events");
  const editable = can("write:events");
  const [staffChoices, setStaffChoices] = useState([]);
  const [equipmentChoices, setEquipmentChoices] = useState([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [equipmentLoaded, setEquipmentLoaded] = useState(false);
  const [catalogErrors, setCatalogErrors] = useState({});
  const [staffId, setStaffId] = useState("");
  const [role, setRole] = useState("ATTENDANT");
  const [lead, setLead] = useState(false);
  const [callTime, setCallTime] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const eventId = event?.id;
  const staff = valueList(event?.operations?.staff ?? event?.staff);
  const equipment = valueList(event?.operations?.equipment ?? event?.equipment);
  const readiness = event?.operations?.readiness;
  const issues = valueList(readiness?.items).filter(item =>
    ["STAFF", "EQUIPMENT"].includes(String(item.category).toUpperCase()) && item.status === "INCOMPLETE");
  const eligibleStaff = staffChoices.filter(person => !staff.some(assigned => assigned.staff_profile_id === person.id));
  const eligibleEquipment = equipmentChoices.filter(asset => !equipment.some(assigned => assigned.equipment_record_id === asset.id));
  const acknowledged = staff.filter(person => person.acknowledgement_status === "ACKNOWLEDGED").length;

  useEffect(() => {
    setStaffId(""); setEquipmentId(""); setRole("ATTENDANT"); setLead(false); setCallTime("");
    setInstructions(""); setNotes(""); setError(""); setNotice("");
    setStaffChoices([]); setEquipmentChoices([]); setStaffLoaded(false); setEquipmentLoaded(false); setCatalogErrors({});
    if (!allowed || !editable || !eventId) return;
    let active = true;
    Promise.allSettled([api.get("/staff?pageSize=100"), api.get("/equipment?pageSize=100")]).then(results => {
      if (!active) return;
      if (results[0].status === "fulfilled") setStaffChoices(valueList(results[0].value?.data));
      if (results[1].status === "fulfilled") setEquipmentChoices(valueList(results[1].value?.data));
      setStaffLoaded(true); setEquipmentLoaded(true);
      setCatalogErrors({
        staff: results[0].status === "rejected" ? results[0].reason?.message || "Staff catalog unavailable." : "",
        equipment: results[1].status === "rejected" ? results[1].reason?.message || "Equipment catalog unavailable." : "",
      });
    });
    return () => { active = false; };
  }, [allowed, editable, eventId]);

  async function act(fn, success) {
    if (busy || !eventId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await fn();
      await onUpdated?.();
      setNotice(success);
    } catch (e) { setError(e.message || "Unable to update this event."); }
    finally { setBusy(false); }
  }

  function saveStaff(e) {
    e.preventDefault();
    if (!staffId || !eligibleStaff.some(person => person.id === staffId)) return;
    act(async () => {
      await api.post(`/events/${eventId}/staff`, {
        staffProfileId: staffId, assignmentRole: role,
        lead_attendant: lead || role === "LEAD_ATTENDANT",
        call_time: callTime, instructions: instructions.trim(), notes: notes.trim(),
      });
      setStaffId(""); setCallTime(""); setInstructions(""); setNotes("");
    }, "Staff member assigned. Confirm their acknowledgement before marking staffing ready.");
  }
  function saveEquipment(e) {
    e.preventDefault();
    if (!equipmentId || !eligibleEquipment.some(asset => asset.id === equipmentId)) return;
    act(async () => {
      await api.post(`/events/${eventId}/equipment`, {equipmentId});
      setEquipmentId("");
    }, "Equipment assigned. Check the readiness requirements and asset lifecycle.");
  }

  if (!allowed) return <Empty>Your account cannot access event operations.</Empty>;
  if (!eventId) return <Empty>Select an event to manage its resources.</Empty>;
  return <div className="c360-p4-stack c360-p4b-resources">
    <Notice error={error} notice={notice} />
    <div className="c360-p4-stats" aria-label="Selected event resource summary">
      <div><UserRound size={20}/><strong>{staff.length}</strong><span>Staff assigned</span></div>
      <div><Boxes size={20}/><strong>{equipment.length}</strong><span>Equipment assigned</span></div>
      <div><CheckCircle2 size={20}/><strong>{acknowledged}<small> / {staff.length}</small></strong><span>Staff acknowledged</span></div>
    </div>
    <div className="c360-p4b-readiness" role="region" aria-label="Staff and equipment readiness">
      <div className="c360-p4b-readiness-head"><div><strong>Resource readiness</strong><p>Live checks for this event, refreshed after assignments.</p></div>
        {readiness && <span className="c360-p4b-readiness-count">{issues.length} outstanding resource checks</span>}
      </div>
      {readiness ? (issues.length ? <ul className="c360-p4b-issues">{issues.map((item,i)=><li key={`${item.category}-${item.label}-${i}`}><span className={item.severity === "CRITICAL" ? "c360-p4b-severity critical" : "c360-p4b-severity"}>{item.severity === "CRITICAL" ? "Critical" : "Attention"}</span><span>{item.label}</span><small>{human(item.category)}</small></li>)}</ul> : <p className="c360-p4b-all-clear">No outstanding staff or equipment checks in the current readiness record.</p>) : <p className="c360-p4b-all-clear">Resource readiness is unavailable for this event. View Event Readiness for the full checklist.</p>}
    </div>
    <Card title="Assigned staff" description="Manage the selected event's team. Availability and scheduling conflicts are enforced by the existing server workflow.">
      {staff.length ? <div className="c360-p4-list">{staff.map((s,i)=><div className="c360-p4-record" key={s.id || i}>
        <div><strong>{s.name || "Staff member"}{(s.lead_attendant || s.assignment_role === "LEAD_ATTENDANT") && <span className="c360-p4b-inline-tag">Lead</span>}</strong>
          <small>{human(s.assignment_role)} · {human(s.acknowledgement_status)}{s.call_time ? ` · Call ${s.call_time}` : ""}</small></div>
        {editable && <button type="button" disabled={busy} onClick={()=>{if(window.confirm(`Remove ${s.name || "this staff member"} from this event?`)) act(()=>api.delete(`/events/${eventId}/staff/${s.id}`),"Staff assignment removed.");}}>Remove</button>}
      </div>)}</div> : <Empty>No staff assigned to this event.</Empty>}
      {editable && <form className="c360-p4b-assignment" onSubmit={saveStaff}>
        <div className="c360-p4b-form-heading"><strong>Assign a team member</strong><span>Enter operational details before assigning.</span></div>
        <div className="c360-p4b-fields">
          <label>Staff member<select required disabled={busy || !staffLoaded || Boolean(catalogErrors.staff)} value={staffId} onChange={e=>setStaffId(e.target.value)}>
            <option value="">{!staffLoaded ? "Loading staff…" : catalogErrors.staff ? "Staff catalog unavailable" : eligibleStaff.length ? "Choose a staff member" : "No unassigned staff in loaded catalog"}</option>
            {eligibleStaff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <label>Assignment role<select disabled={busy} value={role} onChange={e=>{setRole(e.target.value);if(e.target.value === "LEAD_ATTENDANT")setLead(true);}}>
            {["ATTENDANT","LEAD_ATTENDANT","EVENT_MANAGER","OTHER"].map(v=><option key={v} value={v}>{human(v)}</option>)}
          </select></label>
          <label>Call time<input type="time" disabled={busy} value={callTime} onChange={e=>setCallTime(e.target.value)}/></label>
          <label className="c360-p4b-toggle"><input type="checkbox" disabled={busy || role === "LEAD_ATTENDANT"} checked={lead || role === "LEAD_ATTENDANT"} onChange={e=>setLead(e.target.checked)}/><span>Designate as lead attendant</span></label>
          <label className="c360-p4b-span">Assignment instructions<input disabled={busy} maxLength={1000} placeholder="Arrival, access, setup details" value={instructions} onChange={e=>setInstructions(e.target.value)}/></label>
          <label className="c360-p4b-span">Internal assignment notes<input disabled={busy} maxLength={1000} placeholder="Optional internal notes" value={notes} onChange={e=>setNotes(e.target.value)}/></label>
        </div>
        {catalogErrors.staff && <p className="c360-p4b-catalog-error" role="alert">Staff catalog: {catalogErrors.staff}</p>}
        <div className="c360-p4b-actions"><button className="primary-action" disabled={busy || !staffId || !eligibleStaff.some(s=>s.id===staffId)}> {busy ? "Saving…" : "Assign staff"}</button><span>Assigning does not acknowledge on behalf of the staff member.</span></div>
      </form>}
    </Card>
    <Card title="Assigned equipment" description="Assign event assets and track their lifecycle using the existing event operations service.">
      {equipment.length ? <div className="c360-p4-list">{equipment.map((asset,i)=><div className="c360-p4-record" key={asset.id || i}>
        <div><strong>{asset.name || "Equipment"}</strong><small>{human(asset.category)} · {human(asset.lifecycle_status)}{asset.asset_uid ? ` · ${asset.asset_uid}` : ""}</small></div>
        {editable && <div className="c360-p4b-item-actions">
          {["CHECKED_OUT","IN_TRANSIT"].includes(asset.lifecycle_status) && <button type="button" disabled={busy} onClick={()=>act(()=>api.post(`/events/${eventId}/equipment/${asset.id}/onsite`,{}),"Equipment marked on site.")}>On site</button>}
          {["ASSIGNED","RESERVED","PENDING"].includes(asset.lifecycle_status) && <button type="button" disabled={busy} onClick={()=>{if(window.confirm(`Check out ${asset.name || "this asset"}?`))act(()=>api.post(`/events/${eventId}/equipment/${asset.id}/checkout`,{condition_before:"GOOD"}),"Equipment checked out.");}}>Check out</button>}
          <button type="button" disabled={busy} onClick={()=>{if(window.confirm(`Remove ${asset.name || "this equipment"} assignment?`))act(()=>api.delete(`/events/${eventId}/equipment/${asset.id}`),"Equipment assignment removed.");}}>Remove</button>
        </div>}
      </div>)}</div> : <Empty>No equipment assigned to this event.</Empty>}
      {editable && <form className="c360-p4b-assignment" onSubmit={saveEquipment}>
        <div className="c360-p4b-form-heading"><strong>Assign an asset</strong><span>Confirm availability and readiness after assignment.</span></div>
        <div className="c360-p4b-equipment-form"><label>Equipment<select required disabled={busy || !equipmentLoaded || Boolean(catalogErrors.equipment)} value={equipmentId} onChange={e=>setEquipmentId(e.target.value)}>
          <option value="">{!equipmentLoaded ? "Loading equipment…" : catalogErrors.equipment ? "Equipment catalog unavailable" : eligibleEquipment.length ? "Choose available equipment" : "No unassigned equipment in loaded catalog"}</option>
          {eligibleEquipment.map(asset=><option key={asset.id} value={asset.id}>{asset.name} · {human(asset.status)}</option>)}
        </select></label><button className="primary-action" disabled={busy || !equipmentId || !eligibleEquipment.some(asset=>asset.id===equipmentId)}>{busy ? "Saving…" : "Assign equipment"}</button></div>
        {catalogErrors.equipment && <p className="c360-p4b-catalog-error" role="alert">Equipment catalog: {catalogErrors.equipment}</p>}
        <p className="c360-p4b-note">Catalog status is informative; the server makes the final availability and conflict decision.</p>
      </form>}
    </Card>
  </div>;
}

export function Client360Files({ records = [], selectedEventId }) {
  const files = valueList(records).filter(f=>!selectedEventId || !f.event_id || f.event_id===selectedEventId);
  return <div className="c360-p4-stack"><div className="c360-p4-stats"><div><FileText size={20}/><strong>{files.length}</strong><span>File records</span></div></div>
    <Card title="Files & documents" description="Client and selected-event file records. Access to underlying file bytes remains controlled by existing secure file services.">
      {files.length?<div className="c360-p4-list">{files.map((f,i)=><div className="c360-p4-record" key={f.id||i}><FileText size={20}/><div><strong>{f.filename||f.name||"Untitled file"}</strong><small>{[f.category,human(f.visibility),f.mime_type].filter(Boolean).join(" · ")}</small></div></div>)}</div>:<Empty>No files found for this selection.</Empty>}
      <p className="c360-p4-caution">Secure previews and uploads will be enabled only after their existing authenticated file endpoints are verified. Private storage URLs are not exposed here.</p>
    </Card>
  </div>;
}

export function Client360Communications({ event, records = [], onUpdated }) {
  const { can } = useAuth();
  const editable = can("write:events");
  const [form,setForm]=useState({type:"PHONE",direction:"OUTBOUND",subject:"",summary:""});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const eventId=event?.id;
  useEffect(()=>{setError("");setNotice("");setForm({type:"PHONE",direction:"OUTBOUND",subject:"",summary:""});},[eventId]);
  const comms = valueList(event?.communications ?? records).filter(c=>!eventId||!c.event_id||c.event_id===eventId);
  async function save(e){e.preventDefault();if(busy||!eventId||!form.summary.trim())return;setBusy(true);setError("");setNotice("");try{await api.post(`/events/${eventId}/communications`,form);setForm({type:"PHONE",direction:"OUTBOUND",subject:"",summary:""});await onUpdated?.();setNotice("Communication recorded.");}catch(err){setError(err.message||"Unable to record communication.");}finally{setBusy(false);}}
  return <div className="c360-p4-stack"><Notice error={error} notice={notice}/><Card title="Communication history" description="Activity recorded against the selected event.">
    {comms.length?<div className="c360-p4-list">{comms.map((c,i)=><div className="c360-p4-record" key={c.id||i}><MessageSquare size={19}/><div><strong>{c.subject||human(c.type)}</strong><small>{human(c.direction)} · {c.message_summary||c.summary||"No summary"}{c.occurred_at?` · ${new Date(c.occurred_at).toLocaleDateString()}`:""}</small></div></div>)}</div>:<Empty>No communications recorded for this event.</Empty>}
    </Card>{editable&&eventId&&<Card title="Log an interaction" description="Record a call, meeting, or message. Logging does not send an email or SMS."><form className="c360-p4-form" onSubmit={save}><label>Type<select value={form.type} onChange={e=>setForm(s=>({...s,type:e.target.value}))}>{["PHONE","EMAIL","SMS","MEETING","OTHER"].map(v=><option key={v} value={v}>{human(v)}</option>)}</select></label><label>Direction<select value={form.direction} onChange={e=>setForm(s=>({...s,direction:e.target.value}))}><option value="OUTBOUND">Outbound</option><option value="INBOUND">Inbound</option></select></label><label className="c360-p4-wide">Subject<input value={form.subject} maxLength={200} onChange={e=>setForm(s=>({...s,subject:e.target.value}))}/></label><label className="c360-p4-wide">Interaction summary<textarea required rows={3} maxLength={3000} value={form.summary} onChange={e=>setForm(s=>({...s,summary:e.target.value}))}/></label><button type="submit" className="primary-action" disabled={busy||!form.summary.trim()}>{busy?"Saving…":"Save interaction"}</button></form></Card>}</div>;
}
