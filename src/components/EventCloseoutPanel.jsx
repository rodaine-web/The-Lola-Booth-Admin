import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
export default function EventCloseoutPanel({eventId}){
 const {can}=useAuth();const [data,setData]=useState(null),[form,setForm]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const allowed=can('write:events')&&(can('communications.send')||can('write:sales'));
 const load=()=>api.get(`/events/${eventId}/closeout`).then(value=>{setData(value);setForm({subject:value.record?.subject||'',body:value.record?.body||'',discount_code:value.record?.discount_code||'',discount_percent:value.record?.discount_percent||'',discount_expires:value.record?.discount_expires?.slice(0,10)||''});});
 useEffect(()=>{let active=true;api.get(`/events/${eventId}/closeout`).then(value=>{if(active){setData(value);setForm({subject:value.record?.subject||'',body:value.record?.body||'',discount_code:value.record?.discount_code||'',discount_percent:value.record?.discount_percent||'',discount_expires:value.record?.discount_expires?.slice(0,10)||''});}}).catch(err=>active&&setError(err.message));return()=>{active=false;};},[eventId]);
 async function save(approve=false,generate=false){if(busy)return;setBusy(true);setError('');try{await api.post(`/events/${eventId}/closeout`,{...form,discount_code:form.discount_code||null,discount_percent:form.discount_percent?Number(form.discount_percent):null,discount_expires:form.discount_expires||null,body:generate?undefined:form.body,approve});setNotice(approve?'Closeout approved and queued for email delivery.':'Draft saved.');await load();}catch(err){setError(err.message);}finally{setBusy(false);}}
 return <section className="panel"><h2>Customer closeout</h2>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{data&&<>
 {!data.record?<p>Closeout is scheduled automatically for events completed after this release. Previously completed events are left unchanged.</p>:<>
 <p>Review begins 24 hours after completion: {new Date(data.record.due_at).toLocaleString()}. {!data.galleryReady&&'Waiting for a published, available gallery.'}</p>
 {data.record.closed_at?<p>Closeout email sent to the provider. Event follow-up is complete.</p>:data.record.approved_at?<p>Approved · Delivery: {data.record.delivery_status}. Review failures in Communications.</p>:data.record.communication_id?<>
 <p>To: {data.record.recipient}. Sending requires your approval. Guest discounts are reviewed and applied manually on future proposals.</p>
 <div className="form-grid"><label>Discount code (optional)<input disabled={!allowed||busy} maxLength={80} value={form.discount_code} onChange={e=>setForm({...form,discount_code:e.target.value})}/></label><label>Discount percentage<input disabled={!allowed||busy} type="number" min="0.01" max="100" step="0.01" value={form.discount_percent} onChange={e=>setForm({...form,discount_percent:e.target.value})}/></label><label>Offer expires<input disabled={!allowed||busy} type="date" value={form.discount_expires} onChange={e=>setForm({...form,discount_expires:e.target.value})}/></label></div>
 {allowed&&<button disabled={busy||!data.eligible} onClick={()=>save(false,true)}>Generate email with offer</button>}
 <label>Email subject<input disabled={!allowed||busy} value={form.subject} maxLength={250} onChange={e=>setForm({...form,subject:e.target.value})}/></label><label>Email body<textarea disabled={!allowed||busy} rows={16} maxLength={12000} value={form.body} onChange={e=>setForm({...form,body:e.target.value})}/></label>
 {allowed&&<div className="button-row"><button disabled={busy||!data.eligible} onClick={()=>save()}>Save draft</button><button className="primary-action" disabled={busy||!data.eligible} onClick={()=>save(true)}>Approve and send final thank-you</button></div>}
 </>:<p>The worker will prepare your draft when the 24-hour wait has elapsed and the gallery is published.</p>}</>}
 </>}</section>;
}
