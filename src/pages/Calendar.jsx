import "../styles/record-workspace.css";
import {calendarCells} from "../utils/calendar-grid.js";
import AsyncState from "../components/AsyncState.jsx";
import RelationshipSelect from "../components/RelationshipSelect.jsx";
import {businessToday,formatDateOnly} from "../utils/display.js";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";

const statusOptions = ["", "INQUIRY", "TENTATIVE", "CONFIRMED", "PREPARING", "READY", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DRAFT", "PENDING_CONTRACT", "PENDING_DEPOSIT"];

export default function Calendar({ embedded = false }) {
  const Container = embedded ? "section" : "main";
  const [advancedFilters,setAdvancedFilters]=useState(true);
  const [view, setView] = useState("month");
  const [date, setDate] = useState(businessToday());
  const [filters, setFilters] = useState({ status: "", eventType: "", venue: "", city: "", experienceId: "", packageId: "", staffId: "", equipmentId: "" });
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [revision,setRevision]=useState(0);

  useEffect(() => {
    setError("");
    const params = new URLSearchParams({ view, date });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    let active=true;setPayload(null);
    api.get(`/calendar?${params}`).then(result=>{if(active)setPayload(result);}).catch(err=>{if(active)setError(err.message);});
    return()=>{active=false;};
  }, [view, date, filters,revision]);

  const grouped = useMemo(() => (payload?.events || []).reduce((map, event) => {
    const day = dateKey(event.event_date);
    map[day] = [...(map[day] || []), event];
    return map;
  }, {}), [payload]);

  function shift(amount) {
    const current = new Date(`${date}T00:00:00Z`);
    if(view==='month'){const day=current.getUTCDate();current.setUTCDate(1);current.setUTCMonth(current.getUTCMonth()+amount);const last=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()+1,0)).getUTCDate();current.setUTCDate(Math.min(day,last));}
    else current.setUTCDate(current.getUTCDate()+(view==='week'?7:1)*amount);
    setDate(current.toISOString().slice(0,10));
  }

  const cells = calendarCells(date, view, payload?.range);

  if (error) return <Container className={embedded?"calendar-workspace":"page calendar-redesign"}><h1>{embedded?"Events":"Calendar"}</h1><AsyncState error={error} onRetry={()=>setRevision(r=>r+1)} noun="calendar"/></Container>;

  return (
    <Container className={embedded ? "calendar-workspace embedded-calendar" : "page calendar-workspace record-module"}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Event operations</p>
          <h1>{embedded ? "Events" : "Calendar"}</h1>
          <p className="lede">Plan. Prepare. Execute.</p>
        </div>
        <div className="calendar-controls">
          <button onClick={()=>setAdvancedFilters(value=>!value)} aria-expanded={advancedFilters}>Filters</button>
          <button onClick={() => setDate(businessToday())}>Today</button>
          <button aria-label="Previous" onClick={() => shift(-1)}><ChevronLeft size={17} /></button>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <button aria-label="Next" onClick={() => shift(1)}><ChevronRight size={17} /></button>
          <div className="segmented">
            {["month", "week", "day"].map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}
          </div>
        </div>
      </div>

      {advancedFilters && <section className="calendar-filter-panel">
        <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>{statusOptions.map((item) => <option key={item} value={item}>{item || "All statuses"}</option>)}</select>
        <input value={filters.eventType} onChange={(event) => setFilters((current) => ({ ...current, eventType: event.target.value }))} placeholder="Event type" />
        <input value={filters.venue} onChange={(event) => setFilters((current) => ({ ...current, venue: event.target.value }))} placeholder="Venue" />
        <input value={filters.city} onChange={(event) => setFilters((current) => ({ ...current, city: event.target.value }))} placeholder="City" />
        <label>Experience<RelationshipSelect resource="experiences" value={filters.experienceId} placeholder="Experience" onChange={value=>setFilters(current=>({...current,experienceId:value||""}))}/></label>
        <label>Package<RelationshipSelect resource="packages" value={filters.packageId} placeholder="Package" onChange={value=>setFilters(current=>({...current,packageId:value||""}))}/></label>
        <label>Staff<RelationshipSelect resource="staff" value={filters.staffId} placeholder="Staff" onChange={value=>setFilters(current=>({...current,staffId:value||""}))}/></label>
        <label>Equipment<RelationshipSelect resource="equipment" value={filters.equipmentId} placeholder="Equipment" onChange={value=>setFilters(current=>({...current,equipmentId:value||""}))}/></label>
        <button onClick={() => setFilters({ status: "", eventType: "", venue: "", city: "", experienceId: "", packageId: "", staffId: "", equipmentId: "" })}><RotateCcw size={15} />Clear Filters</button>
      </section>}

      {payload?.legend && <div className="calendar-legend">{payload.legend.map((item) => <span key={item.status} className={`legend-${item.tone}`}>{item.label}</span>)}</div>}

      <div className="calendar-month-heading"><h2>{new Date(`${date.slice(0,7)}-01T12:00:00Z`).toLocaleDateString("en-US",{month:"long",year:"numeric",timeZone:"UTC"})}</h2><span>{payload?.timeZone || ""}</span></div>
      {view!=="day"&&<div className="calendar-weekdays">{cells.slice(0,7).map(day=><span key={day}>{new Date(day+"T12:00:00Z").toLocaleDateString("en-US",{weekday:"short",timeZone:"UTC"})}</span>)}</div>}
      <div className={`calendar calendar-${view} reference-calendar-grid`}>
        {cells.map(day=><section key={day} className={day.slice(0,7)===date.slice(0,7)?"calendar-day":"calendar-day outside-month"} aria-label={formatDateOnly(day)}>
          <h2>{new Date(day+"T12:00:00Z").getUTCDate()}</h2>
          {(grouped[day]||[]).map(event=><CalendarEvent key={event.id} event={event} compact={view!=="day"}/>) }
        </section>)}
      </div>
      {payload && !payload.events?.length && <p className="note-text">Nothing is booked for this date range.</p>}
    </Container>
  );
}

function CalendarEvent({ event, compact }) {
  return (
    <Link to={event.href || `/events/events/${event.id}`} className={`calendar-event ${String(event.status||"TENTATIVE").toLowerCase()} ${compact?"compact-calendar-event":""}`}>
      <strong>{event.client_name || event.event_name}</strong>
      {!compact&&<><span>{event.start_time || "Time TBD"} · {event.venue_name || "Venue TBD"}</span>
      <small>{event.event_type} · {event.experience_name || "Experience TBD"} · {event.status}</small>
      <small>Setup {event.phases?.setup?.start || "TBD"} · Live {event.phases?.live?.start || "TBD"}-{event.phases?.live?.end || "TBD"} · Breakdown {event.phases?.breakdown?.end || "TBD"}</small>
      <small>{event.staff_count} staff · {event.equipment_count} equipment · {event.readiness_status}</small></>}
    </Link>
  );
}

function dateKey(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}
