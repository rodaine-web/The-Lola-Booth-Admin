import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { FileText, ShieldCheck, Image as ImageIcon, MessageSquare, LockKeyhole } from 'lucide-react';

const list = value => Array.isArray(value) ? value : [];
const plain = value => String(value || 'Not set').replaceAll('_',' ');
const money = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)) : '—';

export function Client360InternalNotes({event,onUpdated}) {
  const {can}=useAuth();
  const [body,setBody]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const eventId=event?.id;
  const notes=list(event?.operations?.notes).filter(note=>note && note.visible_to_attendant !== true);
  useEffect(()=>{setBody('');setError('');setNotice('');},[eventId]);
  if(!eventId || !can('write:operations')) return null;
  async function submit(e){e.preventDefault();if(busy||!body.trim())return;setBusy(true);setError('');setNotice('');try{
    await api.post(`/events/${eventId}/notes`,{body:body.trim(),visible_to_attendant:false,pinned:false});
    await onUpdated?.();setBody('');setNotice('Internal note saved.');
  }catch(err){setError(err.message||'Unable to save note.');}finally{setBusy(false);}}
  return <section className="c360-finish-card"><div className="c360-finish-heading"><MessageSquare size={18}/><div><h3>Internal event notes</h3><p>Visible to authorized operations staff, not posted to the client portal.</p></div></div>
    {error&&<p role="alert" className="c360-p4-error">{error}</p>}{notice&&<p role="status" className="c360-p4-notice">{notice}</p>}
    {notes.length?<div className="c360-finish-list">{notes.map((n,i)=><article key={n.id||i}><p>{n.body}</p><small>{n.created_at?new Date(n.created_at).toLocaleString():''}{n.pinned?' · Pinned':''}</small></article>)}</div>:<p className="c360-finish-empty">No internal event notes yet.</p>}
    <form className="c360-finish-note-form" onSubmit={submit}><label htmlFor="c360-internal-note">Add internal note</label><textarea id="c360-internal-note" maxLength={3000} rows={3} value={body} onChange={e=>setBody(e.target.value)} required placeholder="Operational instructions or private follow-up…"/><button className="primary-action" disabled={busy||!body.trim()} type="submit">{busy?'Saving…':'Save internal note'}</button></form>
  </section>;
}

export function Client360GallerySummary({event,eventUrl,galleryUrl}){
  const {can}=useAuth();
  if(!can('read:events'))return <p className="c360-finish-empty">Event gallery information is restricted.</p>;
  const galleries=list(event?.operations?.galleries);
  return <div className="c360-finish-stack"><div className="c360-finish-stats"><div><ImageIcon size={19}/><strong>{galleries.length}</strong><small>Event galleries</small></div><div><ShieldCheck size={19}/><strong>{galleries.filter(g=>['PUBLISHED','LIVE'].includes(String(g.status).toUpperCase())).length}</strong><small>Published galleries</small></div></div>
    {galleries.length?<div className="c360-finish-list">{galleries.map((g,i)=><article key={g.id||i}><strong>{g.gallery_name||g.name||'Event gallery'}</strong><small>{plain(g.status)} · Sharing remains permission controlled</small></article>)}</div>:<p className="c360-finish-empty">No gallery records are attached to this event yet.</p>}
    <div className="c360-finish-actions">{galleryUrl&&<Link to={galleryUrl}>Manage gallery and sharing</Link>}{eventUrl&&<Link to={eventUrl}>Event operations</Link>}</div>
    <p className="c360-finish-footnote">Fiesta/Dropbox matching and optional Lob postcards continue in the existing event gallery workflow; this view does not create guest commerce or public download links.</p>
  </div>;
}

export function Client360FinanceSummary({client,event,proposals=[],invoices=[],payments=[]}){
  const {can}=useAuth();if(!can('read:finance'))return <p className="c360-finish-empty">Finance information is restricted.</p>;
  const allInv=list(invoices),allProp=list(proposals),allPay=list(payments);
  const relevant=(rows)=>rows.filter(r=>!event?.id||!r.event_id||r.event_id===event.id);
  const filteredInv=relevant(allInv),filteredProp=relevant(allProp),filteredPay=relevant(allPay);
  const due=filteredInv.reduce((n,r)=>n+Number(r.balance_due||0),0);
  return <div className="c360-finish-stack"><div className="c360-finish-stats"><div><FileText size={19}/><strong>{filteredInv.length}</strong><small>Invoices</small></div><div><ShieldCheck size={19}/><strong>{filteredProp.length}</strong><small>Proposals</small></div><div><FileText size={19}/><strong>{money(due)}</strong><small>Invoice balance</small></div></div>
    <div className="c360-finish-grid"><section className="c360-finish-card"><h3>Invoices</h3>{filteredInv.length?filteredInv.map((r,i)=><div className="c360-finish-linkrow" key={r.id||i}><div><strong>{r.invoice_number||'Invoice'}</strong><small>{plain(r.status)} · {money(r.balance_due)}</small></div>{r.id&&<Link to={`/finance/invoices/${r.id}`}>View</Link>}</div>):<p className="c360-finish-empty">No matching invoices.</p>}</section>
    <section className="c360-finish-card"><h3>Proposals</h3>{filteredProp.length?filteredProp.map((r,i)=><div className="c360-finish-linkrow" key={r.id||i}><div><strong>{r.proposal_number||'Proposal'}</strong><small>{plain(r.status)} · {money(r.total)}</small></div>{r.id&&<Link to={`/sales/proposals/${r.id}`}>View</Link>}</div>):<p className="c360-finish-empty">No matching proposals.</p>}</section></div>
    <section className="c360-finish-card"><h3>Payments</h3><p>{filteredPay.length} payment records associated with this selection.</p>{filteredPay.slice(0,15).map((r,i)=><div key={r.id||i} className="c360-finish-linkrow"><div><strong>{money(r.amount)}</strong><small>{plain(r.status||r.payment_method)} · {r.payment_date||''}</small></div></div>)}</section>
    <p className="c360-finish-footnote">These are existing accounting records. Invoice editing and payment capture remain in their permission-protected finance workflows.</p>
  </div>;
}

export function Client360ClientVisibility({event,files=[]}){
  const {can}=useAuth();if(!can('read:sales'))return null;
  const eventFiles=list(files).filter(r=>!event?.id||!r.event_id||r.event_id===event.id);
  const clientFiles=eventFiles.filter(r=>Boolean(r.customer_shared_at)&&r.canShareWithClient);
  const internalFiles=eventFiles.filter(r=>!r.customer_shared_at||!r.canShareWithClient);
  return <section className="c360-finish-card"><div className="c360-finish-heading"><LockKeyhole size={19}/><div><h3>Client-facing visibility summary</h3><p>Read-only staff summary; not a client-session impersonation or shareable preview link.</p></div></div><div className="c360-finish-stats"><div><strong>{clientFiles.length}</strong><small>Shared with client</small></div><div><strong>{internalFiles.length}</strong><small>Not shared with client</small></div></div><p className="c360-finish-footnote">Explicit sharing grants determine these counts; actual client access still follows server-side workspace authorization. This view never uses or creates a client access token.</p></section>;
}
