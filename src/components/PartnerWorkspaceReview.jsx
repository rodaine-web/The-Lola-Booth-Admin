import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
export default function PartnerWorkspaceReview({partnerId,events,editable}){
 const [data,setData]=useState(null),[files,setFiles]=useState([]),[eventId,setEventId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const base=`/partners/${partnerId}/workspace`;
 async function load(){setData(await api.get(base+'/review'));}
 useEffect(()=>{let active=true;api.get(base+'/review').then(value=>active&&setData(value)).catch(e=>active&&setError(e.message));return()=>{active=false;};},[base]);
 useEffect(()=>{let active=true;setFiles([]);if(eventId)api.get(`/events/${eventId}/files`).then(value=>active&&setFiles(value.data||[])).catch(e=>active&&setError(e.message));return()=>{active=false;};},[eventId]);
 async function act(fn){setBusy(true);setError('');try{await fn();await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section><h3>Partner requests &amp; shared files</h3><label>Event for file sharing<select value={eventId} onChange={e=>setEventId(e.target.value)}><option value="">Choose event</option>{events.map(e=><option key={e.id} value={e.id}>{e.event_name}</option>)}</select></label>{files.filter(f=>f.visibility==='PRIVATE'&&['DESIGN','VENUE','OTHER'].includes(f.category)).map(f=>{const shared=data?.shared.some(s=>s.file_id===f.id);return <p key={f.id}>{f.filename} {editable&&<button disabled={busy} onClick={()=>act(()=>api.post(base+'/files',{fileId:f.id,shared:!shared}))}>{shared?'Remove partner access':'Share with partner'}</button>}</p>;})}
 {data?.requests.map(r=><article key={r.id}><strong>{r.event_name}</strong><p>{r.message} · {r.status.toLowerCase()}</p>{editable&&r.status==='OPEN'&&<button disabled={busy} onClick={()=>act(()=>api.post(`${base}/requests/${r.id}/resolve`,{}))}>Mark request resolved</button>}</article>)}{error&&<p role="alert">{error}</p>}</section>;
}
