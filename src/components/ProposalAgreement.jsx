import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';

export default function ProposalAgreement({proposal}) {
  const {can}=useAuth();
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
    <p>Review your approved service terms, then create a secure signing link. Signing is separate from accepting the proposal and paying the deposit.</p>
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert" className="toast error">{error}</p>}
    {!records&&!error&&<p role="status">Loading agreements…</p>}
    {records&&proposal.status!=='ACCEPTED'&&<p>Accept the proposal before creating an agreement.</p>}
    {records&&can('write:sales')&&proposal.status==='ACCEPTED'&&(!active||active.status==='DRAFT')&&<form onSubmit={e=>{e.preventDefault();act(()=>active?api.patch(`/contracts/${active.id}`,{title,terms}):api.post(`/proposals/${proposal.id}/contracts`,{title,terms}));}}>
      <label>Agreement title<input required minLength={3} maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label>
      <label>Approved service terms<textarea required minLength={20} maxLength={50000} rows={12} value={terms} onChange={e=>setTerms(e.target.value)} disabled={busy} placeholder="Paste the service agreement approved for your business."/></label>
      <button className="primary-action" disabled={busy}>{busy?'Saving…':active?'Save draft':'Create agreement draft'}</button>
    </form>}
    {records&&can('write:sales')&&proposal.status==='ACCEPTED'&&<div className="button-row"><button disabled={busy} onClick={()=>act(async()=>{setWorkspaceUrl((await api.post(`/proposals/${proposal.id}/workspace`,{})).url);})}>Open client workspace link</button><button disabled={busy} onClick={()=>act(async()=>{await api.post(`/proposals/${proposal.id}/workspace/revoke`,{});setWorkspaceUrl('');setNotice('Workspace access revoked. Existing individual document links are managed separately.');})}>Revoke workspace link</button></div>}
    {workspaceUrl&&<div role="status"><label>Client workspace link<input readOnly value={workspaceUrl} onFocus={e=>e.target.select()}/></label><a href={workspaceUrl} target="_blank" rel="noreferrer">Preview client workspace</a><p>Share only with this client. This workspace covers this event.</p></div>}
    {records?.map(record=><article key={record.id} className="panel"><h3>{record.title} · Revision {record.revision}</h3><p>{record.status}{record.signed_at?` · Signed by ${record.signer_name} on ${new Date(record.signed_at).toLocaleString()}`:''}</p>
      <div className="button-row"><button disabled={busy} onClick={()=>act(()=>api.download(`/contracts/${record.id}/pdf`,'LOLA-agreement.pdf'))}>Download {record.status==='SIGNED'?'signed copy':'agreement'}</button>
      {can('write:sales')&&record.status==='DRAFT'&&<button className="primary-action" disabled={busy||record.title!==title||record.terms!==terms} onClick={()=>act(async()=>{const issued=await api.post(`/contracts/${record.id}/issue`,{});setSigningUrl(issued.signing_url);})}>Create signing link</button>}
      {can('write:sales')&&['ISSUED','SIGNED'].includes(record.status)&&<><button disabled={busy} onClick={()=>act(async()=>{setSigningUrl((await api.post(`/contracts/${record.id}/access`,{})).signing_url);})}>Open secure link</button><button disabled={busy} onClick={()=>act(async()=>{const result=await api.post(`/contracts/${record.id}/send`,{});setNotice(result.status==='SENT_TO_PROVIDER'?'Agreement email accepted by the provider.':result.status==='DEVELOPMENT_ONLY'?'Development preview only; no external email sent.':result.status==='UNKNOWN'?'Email outcome is uncertain. Review provider history before retrying.':'Email failed. Check communications before retrying.');})}>{record.status==='SIGNED'?'Email signed copy':'Email agreement'}</button></>}
      {can('write:sales')&&['DRAFT','ISSUED'].includes(record.status)&&<button disabled={busy} onClick={()=>act(async()=>{await api.post(`/contracts/${record.id}/revoke`,{});setSigningUrl('');})}>Revoke agreement</button>}</div>
      {record.deliveries?.map(delivery=><p key={delivery.purpose}>{delivery.purpose==='SIGNED_COPY'?'Signed copy':'Invitation'}: {delivery.status.replaceAll('_',' ')} · Attempts {delivery.attempt_count}</p>)}
      {record.status==='ISSUED'&&<p>The issued terms are locked. Revoke this agreement to replace it.</p>}
    </article>)}
    {signingUrl&&<div role="status"><label>Secure signing link<input readOnly value={signingUrl} onFocus={e=>e.target.select()}/></label><a href={signingUrl} target="_blank" rel="noreferrer">Preview client agreement</a><p>Share this link only with the client. Use Email agreement to deliver it through the configured email provider.</p></div>}
  </section>;
}
