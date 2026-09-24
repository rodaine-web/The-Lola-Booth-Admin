import RelationshipSelect from "../components/RelationshipSelect.jsx";
import {businessToday,formatDateOnly} from "../utils/display.js";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";

const statusOptions = ["", "INQUIRY", "TENTATIVE", "CONFIRMED", "PREPARING", "READY", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DRAFT", "PENDING_CONTRACT", "PENDING_DEPOSIT"];

export default function Calendar() {
  const [view, setView] = useState("month");
  const [date, setDate] = useState(businessToday());
  const [filters, setFilters] = useState({ status: "", eventType: "", venue: "", city: "", experienceId: "", packageId: "", staffId: "", equipmentId: "" });
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ view, date });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    api.get(`/calendar?${params}`).then(setPayload).catch((err) => setError(err.message));
  }, [view, date, filters]);

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

  if (error) return <main className="page"><div className="toast error">{error}</div></main>;

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Event operations</p>
          <h1>Calendar</h1>
          {payload && <p className="lede">{payload.range.startDate} to {payload.range.endDate} · {payload.timeZone}</p>}
        </div>
        <div className="calendar-controls">
          <button onClick={() => setDate(businessToday())}>Today</button>
          <button aria-label="Previous" onClick={() => shift(-1)}><ChevronLeft size={17} /></button>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <button aria-label="Next" onClick={() => shift(1)}><ChevronRight size={17} /></button>
          <div className="segmented">
            {["month", "week", "day"].map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}
          </div>
        </div>
      </div>

      <section className="calendar-filter-panel">
        <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>{statusOptions.map((item) => <option key={item} value={item}>{item || "All statuses"}</option>)}</select>
        <input value={filters.eventType} onChange={(event) => setFilters((current) => ({ ...current, eventType: event.target.value }))} placeholder="Event type" />
        <input value={filters.venue} onChange={(event) => setFilters((current) => ({ ...current, venue: event.target.value }))} placeholder="Venue" />
        <input value={filters.city} onChange={(event) => setFilters((current) => ({ ...current, city: event.target.value }))} placeholder="City" />
        <label>Experience<RelationshipSelect resource="experiences" value={filters.experienceId} placeholder="Experience" onChange={value=>setFilters(current=>({...current,experienceId:value||""}))}/></label>
        <label>Package<RelationshipSelect resource="packages" value={filters.packageId} placeholder="Package" onChange={value=>setFilters(current=>({...current,packageId:value||""}))}/></label>
        <label>Staff<RelationshipSelect resource="staff" value={filters.staffId} placeholder="Staff" onChange={value=>setFilters(current=>({...current,staffId:value||""}))}/></label>
        <label>Equipment<RelationshipSelect resource="equipment" value={filters.equipmentId} placeholder="Equipment" onChange={value=>setFilters(current=>({...current,equipmentId:value||""}))}/></label>
        <button onClick={() => setFilters({ status: "", eventType: "", venue: "", city: "", experienceId: "", packageId: "", staffId: "", equipmentId: "" })}><RotateCcw size={15} />Clear Filters</button>
      </section>

      {payload?.legend && <div className="calendar-legend">{payload.legend.map((item) => <span key={item.status} className={`legend-${item.tone}`}>{item.label}</span>)}</div>}

      <div className={`calendar calendar-${view}`}>
        {Object.entries(grouped).map(([day, dayEvents]) => (
          <section key={day}>
            <h2>{formatDateOnly(day,{weekday:"short",month:"short"})}</h2>
            {dayEvents.map((event) => <CalendarEvent key={event.id} event={event} />)}
          </section>
        ))}
        {!payload?.events?.length && <div className="empty-state">Nothing is booked for this date range.</div>}
      </div>
    </main>
  );
}

function CalendarEvent({ event }) {
  return (
    <Link to={event.href} className={`calendar-event ${event.status.toLowerCase()}`}>
      <strong>{event.client_name || event.event_name}</strong>
      <span>{event.start_time || "Time TBD"} · {event.venue_name || "Venue TBD"}</span>
      <small>{event.event_type} · {event.experience_name || "Experience TBD"} · {event.status}</small>
      <small>Setup {event.phases.setup.start || "TBD"} · Live {event.phases.live.start || "TBD"}-{event.phases.live.end || "TBD"} · Breakdown {event.phases.breakdown.end || "TBD"}</small>
      <small>{event.staff_count} staff · {event.equipment_count} equipment · {event.readiness_status}</small>
    </Link>
  );
}

function dateKey(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}
