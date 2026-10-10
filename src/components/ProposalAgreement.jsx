import {proposalAllowsAgreement} from '../../shared/contracts.js';
import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';

export default function ProposalAgreement({proposal}) {
  const {can,user}=useAuth();
  const [records,setRecords]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [title,setTitle]=useState('Event service agreement'),[terms,setTerms]=useState(''),[signingUrl,setSigningUrl]=useState('');
  const [available,setAvailable]=useState(true);
  const [notice,setNotice]=useState('');
  const [workspaceUrl,setWorkspaceUrl]=useState('');
  useEffect(()=>{let current=true;setRecords(null);setSigningUrl('');setWorkspaceUrl('');setAvailable(true);setError('');setTitle('Event service agreement');setTerms('');
    api.get(`/proposals/${proposal.id}/contracts`).then(data=>{if(current){setRecords(data);const draft=data.find(r=>r.status==='DRAFT');if(draft){setTitle(draft.title);setTerms(draft.terms);}}})
      .catch(err=>{if(current){if(err.status===404)setAvailable(false);else setError(err.message);}});
    return()=>{current=false;};
  },[proposal.id]);
  async function act(fn){if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();setRecords(await api.get(`/proposals/${proposal.id}/contracts`));}catch(err){setError(err.message);}finally{setBusy(false);}}
  if(!available)return null;
  const active=records?.find(r=>['DRAFT','ISSUED'].includes(r.status));
  return <section className="panel"><p className="eyebrow">Version 1.1 · Agreement</p><h2>Client agreement</h2>
    <p>Review your approved service terms, then create a secure signing link. Signing is separate from accepting the proposal and paying the booking retainer fee.</p>
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert" className="toast error">{error}</p>}
    {!records&&!error&&<p role="status">Loading agreements…</p>}
    {records&&!proposalAllowsAgreement(proposal.status)&&<p>Accept the proposal before creating an agreement.</p>}
    {records&&can('write:sales')&&proposalAllowsAgreement(proposal.status)&&(!active||active.status==='DRAFT')&&<form onSubmit={e=>{e.preventDefault();act(()=>active?api.patch(`/contracts/${active.id}`,{title,terms}):api.post(`/proposals/${proposal.id}/contracts`,{title,terms}));}}>
      <label>Agreement title *<input required minLength={3} maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label>
      <label>Approved service terms *<textarea required minLength={20} maxLength={50000} rows={12} value={terms} onChange={e=>setTerms(e.target.value)} disabled={busy} placeholder="Paste the service agreement approved for your business."/></label>
      <button className="primary-action" disabled={busy}>{busy?'Saving…':active?'Save draft':'Create agreement draft'}</button>
    </form>}
    {records&&can('write:sales')&&proposalAllowsAgreement(proposal.status)&&<div className="button-row"><button disabled={busy} onClick={()=>act(async()=>{setNotice((await api.post(`/proposals/${proposal.id}/workspace/invite`,{})).message);})}>Send secure workspace invitation</button><button disabled={busy} onClick={()=>act(async()=>{await api.post(`/proposals/${proposal.id}/workspace/revoke`,{});setWorkspaceUrl('');setNotice('Workspace access revoked. Existing individual document links are managed separately.');})}>Revoke workspace link</button></div>}
    {workspaceUrl&&<div role="status"><label>Client workspace link<input readOnly value={workspaceUrl} onFocus={e=>e.target.select()}/></label><a href={workspaceUrl} target="_blank" rel="noreferrer">Preview client workspace</a><p>Share only with this client. This workspace covers this event.</p></div>}
    {user?.roles?.some(role=>['OWNER','ADMIN'].includes(role))&&can('write:finance')&&proposal.event_id&&!records?.some(record=>record.status==='SIGNED')&&<PaymentExceptionForm eventId={proposal.event_id} busy={busy} act={act} onSaved={()=>setNotice('Payment exception recorded. Review or replace any issued agreement so the client signs the written arrangement.')}/>}
    {records?.map(record=><article key={record.id} className="panel"><h3>{record.title} · Revision {record.revision}</h3><p>{record.status}{record.signed_at?` · Signed by ${record.signer_name} on ${new Date(record.signed_at).toLocaleString()}`:''}</p>
      <div className="button-row"><button disabled={busy} onClick={()=>act(()=>api.download(`/contracts/${record.id}/pdf`,'LOLA-agreement.pdf'))}>Download {record.status==='SIGNED'?'signed copy':'agreement'}</button>
      {can('write:sales')&&record.status==='DRAFT'&&<button className="primary-action" disabled={busy||record.title!==title||record.terms!==terms} onClick={()=>act(async()=>{const issued=await api.post(`/contracts/${record.id}/issue`,{});setSigningUrl(issued.signing_url);})}>Create signing link</button>}
      {can('write:sales')&&['ISSUED','SIGNED'].includes(record.status)&&<><button disabled={busy} onClick={()=>act(async()=>{setSigningUrl((await api.post(`/contracts/${record.id}/access`,{})).signing_url);})}>Open secure link</button><button disabled={busy} onClick={()=>act(async()=>{const result=await api.post(`/contracts/${record.id}/send`,{});setNotice(result.status==='SENT_TO_PROVIDER'?'Agreement email accepted by the provider.':result.status==='DEVELOPMENT_ONLY'?'Development preview only; no external email sent.':result.status==='UNKNOWN'?'Email outcome is uncertain. Review provider history before retrying.':'Email failed. Check communications before retrying.');})}>{record.status==='SIGNED'?'Email signed copy':'Email agreement'}</button></>}
      {can('write:sales')&&['DRAFT','ISSUED'].includes(record.status)&&<button disabled={busy} onClick={()=>act(async()=>{await api.post(`/contracts/${record.id}/revoke`,{});setSigningUrl('');})}>Revoke agreement</button>}</div>
      {record.deliveries?.map(delivery=><p key={delivery.purpose}>{delivery.purpose==='SIGNED_COPY'?'Signed copy':'Invitation'}: {delivery.status.replaceAll('_',' ')} · Attempts {delivery.attempt_count}</p>)}
      {record.status==='ISSUED'&&user?.roles?.some(role=>['OWNER','ADMIN'].includes(role))&&can('write:sales')&&<SigningExtensionForm record={record} busy={busy} act={act}/>}
      {record.status==='ISSUED'&&<p>The issued terms are locked. Revoke this agreement to replace it.</p>}
    </article>)}
    {signingUrl&&<div role="status"><label>Secure signing link<input readOnly value={signingUrl} onFocus={e=>e.target.select()}/></label><a href={signingUrl} target="_blank" rel="noreferrer">Preview client agreement</a><p>Share this link only with the client. Use Email agreement to deliver it through the configured email provider.</p></div>}
  </section>;
}

function SigningExtensionForm({record,busy,act}){
 const [dueAt,setDueAt]=useState(''),[reason,setReason]=useState('');
 return <details><summary>Extend signing deadline (Admin review)</summary><p>Signing deadline: {record.signing_due_at?new Date(record.signing_due_at).toLocaleString():'Not recorded'}</p><form onSubmit={e=>{e.preventDefault();act(()=>api.post(`/contracts/${record.id}/signing-extension`,{dueAt:new Date(dueAt).toISOString(),reason}));}}><label>New signing deadline *<input required type="datetime-local" value={dueAt} disabled={busy} onChange={e=>setDueAt(e.target.value)}/></label><label>Reason *<textarea required minLength={20} maxLength={3000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label><button disabled={busy}>Record approved extension</button></form></details>;
}
function PaymentExceptionForm({eventId,busy,act,onSaved}){
 const [form,setForm]=useState({minimum_before_agreement:'',minimum_before_confirmation:'',balance_due_date:'',reason:''});
 const change=(key,value)=>setForm(current=>({...current,[key]:value}));
 return <details><summary>Approve written payment exception (Owner / Admin)</summary><p>Exceptions change payment prerequisites. Review the resulting written agreement before sending it. Signed agreements require a separate amendment.</p><form onSubmit={e=>{e.preventDefault();act(async()=>{await api.post(`/events/${eventId}/payment-exception`,form);onSaved();});}}>{[['minimum_before_agreement','Minimum paid before agreement'],['minimum_before_confirmation','Minimum paid before confirmation']].map(([key,label])=><label key={key}>{label} *<input required type="number" min="0" step="0.01" value={form[key]} disabled={busy} onChange={e=>change(key,e.target.value)}/></label>)}<label>Balance due date *<input required type="date" value={form.balance_due_date} disabled={busy} onChange={e=>change('balance_due_date',e.target.value)}/></label><label>Written arrangement / reason *<textarea required minLength={20} maxLength={3000} value={form.reason} disabled={busy} onChange={e=>change('reason',e.target.value)}/></label><button disabled={busy}>Approve and record exception</button></form></details>;
}
