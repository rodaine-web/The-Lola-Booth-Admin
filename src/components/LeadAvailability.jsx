import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../api/client.js';
import {DashboardCard} from './RecordDashboard.jsx';
import {formatDateOnly,formatTimestamp} from '../utils/display.js';

export default function LeadAvailability({lead,canReview,onUpdated,onTasks}) {
 const [preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pendingChecked,setPendingChecked]=useState(false),[clientVerified,setClientVerified]=useState(false);
 async function refresh(){setError('');try{setPreview(await api.get(`/leads/${lead.id}/availability`));}catch(e){setError(e.message);}}
 useEffect(()=>{let active=true;setPreview(null);api.get(`/leads/${lead.id}/availability`).then(value=>{if(active)setPreview(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[lead.id,lead.updated_at]);
 async function confirm(confirmed){setPendingChecked(confirmed);setBusy(true);setError('');try{const result=await api.post(`/leads/${lead.id}/availability`,{confirmed,fingerprint:preview.fingerprint,calendarRevision:preview.calendar.revision,...(clientVerified&&preview.existingClient?{clientId:preview.existingClient.id}:{})});setPreview(current=>({...current,...result}));await onUpdated();}catch(e){setError(e.message);await refresh();setError(e.message);}finally{setBusy(false);}}
 return <DashboardCard title="Availability & next action">
  <p>Review the booking calendar before sending a proposal. This approval does not reserve equipment or confirm the booking.</p>
  <Link to={`/events/calendar?date=${lead.event_date || ''}&view=day`}>Open booking calendar →</Link>
  {error&&<p role="alert" className="toast error">{error}</p>}
  {preview&&<>
   <p>{preview.calendar.events.length} event(s) on this date or adjacent days. Check hours, holds and capacity.</p>
   {preview.calendar.events.length>0&&<details><summary>Calendar commitments</summary><ul>{preview.calendar.events.map(event=><li key={event.id}><Link to={`/events/events/${event.id}`}>{event.event_name}</Link> · {formatDateOnly(event.event_date)} · {event.start_time?.slice(0,5)}–{event.end_time?.slice(0,5)} · {event.status.replaceAll('_',' ')}{event.active_hold?' · Active hold':''}</li>)}</ul></details>}
   <button type="button" disabled={busy} onClick={refresh}>Refresh availability</button>
   {preview.existingClient&&<div className="record-inquiry-note"><p>This email matches existing client <Link to={`/sales/clients/${preview.existingClient.id}`}>{preview.existingClient.name}</Link>.</p><label style={{display:'flex',gap:10,alignItems:'flex-start'}}><input type="checkbox" style={{width:20,height:20,flexShrink:0}} checked={clientVerified} disabled={busy||!canReview} onChange={e=>setClientVerified(e.target.checked)}/>I verified this request belongs to the matching client.</label></div>}
   <label style={{display:'flex',gap:10,alignItems:'flex-start',margin:'16px 0'}}><input type="checkbox" style={{width:20,height:20,flexShrink:0}} checked={busy?pendingChecked:preview.confirmed} disabled={busy||!canReview||(preview.existingClient&&!clientVerified)||!lead.event_date||!lead.event_start_time||!lead.event_end_time} onChange={e=>confirm(e.target.checked)}/>Availability checked and confirmed</label>
   {!lead.event_date||!lead.event_start_time||!lead.event_end_time?<p>Required: event date, start time and end time.</p>:null}
   {busy?<p role="status">Saving availability approval…</p>:preview.confirmed&&<p>Confirmed by {preview.confirmedBy || 'staff'} · {formatTimestamp(preview.confirmedAt)}</p>}
   {preview.custom?<><strong>Next: schedule a discovery call</strong><p>A Custom package was selected. Discuss the request and prepare a tailored proposal after the call. No automatic proposal will be sent.</p><button onClick={onTasks}>View discovery-call task</button></>:preview.review?<p>{preview.review}</p>:<p>{preview.confirmed?(preview.automationEnabled?'Standard proposal queued, or an existing proposal retained. Check Proposals and Activity for delivery.':'Availability saved. Automatic sending is currently paused.'):'Confirm availability to generate and send the standard proposal.'}</p>}
  </>}
 </DashboardCard>;
}
