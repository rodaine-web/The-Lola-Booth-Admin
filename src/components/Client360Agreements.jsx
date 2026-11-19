import {useEffect,useMemo,useState} from 'react';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
import DocumentPreview from './DocumentPreview.jsx';
import {FileSignature,ShieldCheck,RefreshCw,Download,Send,Bell,FileText,AlertCircle,CheckCircle2,History,Eye,RotateCcw,CalendarClock,Search,XCircle} from 'lucide-react';

const rowsOf = v => Array.isArray(v)?v:Array.isArray(v?.data)?v.data:Array.isArray(v?.contracts)?v.contracts:Array.isArray(v?.rows)?v.rows:[];
const pretty = v => String(v||'UNKNOWN').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,x=>x.toUpperCase());
const fmt = v => {if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';};
const upper = v => String(v||'').toUpperCase();
const titleOf = r => r?.title||r?.name||r?.contract_number||r?.agreement_number||r?.proposal_number||'Event services agreement';
const statusOf = r => upper(r?.status||r?.signature_status);
const clientIdOf = r => r?.client_id||r?.clientId||r?.customer_id;
const eventIdOf = r => r?.event_id||r?.eventId;
const toISO = v => {const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null;};

/** Authenticated, scoped staff workbench. Never uses public tokens or opens client sessions. */
export default function Client360Agreements({client,event,onUpdated}) {
 const {can}=useAuth();
 const canRead=can('read:sales');
 const canWrite=can('write:sales');
 const [records,setRecords]=useState([]),[selectedId,setSelectedId]=useState('');
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[search,setSearch]=useState('');
 const [pending,setPending]=useState(null),[reason,setReason]=useState(''),[dueAt,setDueAt]=useState('');
 const [version,setVersion]=useState(0);
 const safeRecords=useMemo(()=>records.filter(r => {
   const cid=clientIdOf(r),eid=eventIdOf(r);
   return (!cid||String(cid)===String(client?.id)) && (!event?.id||!eid||String(eid)===String(event.id));
 }),[records,client?.id,event?.id]);
 const visible=useMemo(()=>safeRecords.filter(r=>`${titleOf(r)} ${r?.status||''} ${r?.contract_number||''}`.toLowerCase().includes(search.toLowerCase())),[safeRecords,search]);
 const selected=safeRecords.find(r=>String(r.id)===selectedId)||null;
 const state=statusOf(selected);
 const count=s=>safeRecords.filter(r=>statusOf(r)===s).length;
 const params=useMemo(()=>{
   if(!client?.id)return null;
   const p=new URLSearchParams({clientId:String(client.id),page:'1',pageSize:'100'});
   if(event?.id)p.set('eventId',String(event.id));
   return p.toString();
 },[client?.id,event?.id]);
 useEffect(()=>{setSelectedId('');setRecords([]);setError('');setNotice('');setVersion(v=>v+1);},[params]);
 useEffect(()=>{if(!params||!canRead)return;let active=true;setLoading(true);setError('');
   api.get(`/contracts?${params}`).then(data=>{if(active)setRecords(rowsOf(data));}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
   return()=>{active=false;};
 },[params,canRead,version]);
 async function reload(){setVersion(v=>v+1);}
 async function download(){if(!selected)return;setBusy(true);setError('');try{await api.download(`/contracts/${selected.id}/pdf`,`LOLA-agreement-${String(selected.id).slice(0,8)}.pdf`);}catch(e){setError(e.message);}finally{setBusy(false);}}
 function ask(action){setPending(action);setReason('');setDueAt('');setError('');}
 async function execute(){
   if(!pending||!selected||busy)return;
   const action=pending;
   if(action==='extend'&&(!toISO(dueAt)||reason.trim().length<20)){setError('Choose a future deadline and provide a reason of at least 20 characters.');return;}
   setBusy(true);setError('');setNotice('');
   try{
     let path,body={};
     if(action==='issue')path=`/contracts/${selected.id}/issue`;
     else if(action==='send'||action==='resend')path=`/contracts/${selected.id}/send`;
     else if(action==='revise')path=`/contracts/${selected.id}/revise`;
     else if(action==='revoke')path=`/contracts/${selected.id}/revoke`;
     else if(action==='extend'){path=`/contracts/${selected.id}/signing-extension`;body={dueAt:toISO(dueAt),reason:reason.trim()};}
     else throw Error('Unsupported agreement action.');
     await api.post(path,body);
     setPending(null);
     setNotice(({issue:'Agreement issued.',send:'Signing email submitted.',resend:'Signing email submitted again; check delivery history before repeating.',revise:'New draft version created.',revoke:'Agreement revoked.',extend:'Signing deadline updated.'})[action]);
     if(action==='revise')setSelectedId('');
     await reload();await onUpdated?.();
   }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 if(!canRead)return <section className="c360-agreements" role="status">You do not have permission to view agreements.</section>;
 return <section className="c360-agreements" aria-label="Agreements and signatures">
  <header className="c360-agree-head"><div><span className="c360-agree-kicker"><ShieldCheck size={15}/> CLIENT 360 / AGREEMENTS</span><h2>Agreements & signatures</h2><p>Manage this client's agreements, PDF records, signature status, and authorized delivery actions without leaving the workspace.</p></div><button type="button" onClick={reload} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
  <div className="c360-agree-stats"><div><strong>{safeRecords.length}</strong><span>Agreements</span></div><div><strong>{count('ISSUED')}</strong><span>Issued / awaiting action</span></div><div><strong>{count('SIGNED')}</strong><span>Signed</span></div></div>
  {error&&<p className="c360-agree-error" role="alert">{error}</p>}{notice&&<p className="c360-agree-note" role="status">{notice}</p>}
  <div className="c360-agree-layout">
   <div className="c360-agree-list" aria-label="Agreements list">
    <label className="c360-agree-search"><Search size={15}/><input aria-label="Search agreements" placeholder="Find an agreement" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    {loading?<p>Loading agreements…</p>:visible.length===0?<div className="c360-agree-empty"><FileSignature size={30}/><strong>No agreements here yet</strong><p>Agreements are created from a proposal. Choose another event if needed.</p></div>:visible.map(r=><button key={r.id} type="button" className={'c360-agree-record '+(selectedId===String(r.id)?'active':'')} onClick={()=>{setSelectedId(String(r.id));setPending(null);setError('');}}><FileText size={19}/><span><strong>{titleOf(r)}</strong><small>{fmt(r.created_at||r.issued_at)} · {r.version_number||r.version?`v${r.version_number||r.version} · `:''}{pretty(statusOf(r))}</small></span><em className={statusOf(r)==='SIGNED'?'signed':statusOf(r)==='ISSUED'?'pending':'draft'}>{pretty(statusOf(r))}</em></button>)}
   </div>
   <div className="c360-agree-detail">
    {!selected?<div className="c360-agree-empty"><Eye size={31}/><strong>Select an agreement</strong><p>Preview the agreement, review its status, and manage the next action.</p></div>:<>
      <div className="c360-agree-detailhead"><div><span className="c360-agree-kicker">AGREEMENT RECORD</span><h3>{titleOf(selected)}</h3><span className={'c360-agree-pill '+(state==='SIGNED'?'signed':state==='ISSUED'?'pending':'draft')}>{state==='SIGNED'?<CheckCircle2 size={14}/>:<History size={14}/>} {pretty(state)}</span></div><div className="c360-agree-actions"><button type="button" disabled={busy} onClick={download}><Download size={16}/> Download</button></div></div>
      <dl className="c360-agree-meta"><div><dt>Version</dt><dd>{selected.version_number||selected.version||'—'}</dd></div><div><dt>Issued</dt><dd>{fmt(selected.issued_at||selected.sent_at)}</dd></div><div><dt>Signed</dt><dd>{fmt(selected.signed_at||selected.executed_at)}</dd></div><div><dt>Signer</dt><dd>{selected.signer_name||selected.signed_by_name||selected.client_name||'—'}</dd></div></dl>
      {canWrite&&<div className="c360-agree-actions c360-agree-actionbar">
       {state==='DRAFT'&&<><button type="button" disabled={busy} onClick={()=>ask('issue')}><FileSignature size={15}/> Issue agreement</button><button type="button" disabled={busy} onClick={()=>ask('send')}><Send size={15}/> Send for signature</button></>}
       {state==='ISSUED'&&<><button type="button" disabled={busy} onClick={()=>ask('resend')}><Bell size={15}/> Resend signing email</button><button type="button" disabled={busy} onClick={()=>ask('extend')}><CalendarClock size={15}/> Extend deadline</button><button type="button" disabled={busy} onClick={()=>ask('revise')}><RotateCcw size={15}/> Create revised draft</button></>}
       {state!=='SIGNED'&&state!=='REVOKED'&&<button type="button" disabled={busy} onClick={()=>ask('revoke')}><XCircle size={15}/> Revoke</button>}
      </div>}
      <DocumentPreview key={selected.id} path={`/contracts/${selected.id}/pdf`} title="Agreement PDF preview"/>
      {state==='SIGNED'?<p className="c360-agree-guard"><ShieldCheck size={18}/> Signed agreement: this record is immutable. Create an amendment or a new version rather than editing the executed document.</p>:<p className="c360-agree-guard"><ShieldCheck size={18}/> Draft editing and agreement creation remain in the existing proposal agreement editor until its field schema is verified for safe inline reuse. Resending uses the existing send endpoint, not a dedicated reminder workflow.</p>}
    </>}
   </div>
  </div>
  {pending&&selected&&<div className="c360-agree-overlay"><div className="c360-agree-dialog" role="dialog" aria-modal="true" aria-labelledby="c360-agree-confirm"><h3 id="c360-agree-confirm">{({issue:'Issue this agreement?',send:'Send for signature?',resend:'Resend signing email?',revise:'Create a revised agreement draft?',revoke:'Revoke this agreement?',extend:'Extend the signing deadline?'})[pending]}</h3><p>{pending==='resend'?'This invokes the existing sending service. It may send a new email to the client; review delivery history before repeating.':pending==='revoke'?'This changes the current agreement status. Confirm only if the agreement should no longer be valid.':'This action uses the existing authenticated agreement service and may affect the client’s signing workflow.'}</p>{pending==='extend'&&<><label>New signing deadline<input type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label><label>Reason (at least 20 characters)<textarea maxLength={3000} value={reason} onChange={e=>setReason(e.target.value)}/></label></>}<div><button type="button" onClick={()=>setPending(null)} disabled={busy}>Cancel</button><button type="button" className="primary-action" onClick={execute} disabled={busy}>{busy?'Working…':'Confirm action'}</button></div></div></div>}
 </section>;
}
