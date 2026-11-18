import PartnerWorkspaceReview from './PartnerWorkspaceReview.jsx';
import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';

export default function PartnerWorkspaceAccess({partnerId}) {
  const {can}=useAuth();
  const [data,setData]=useState(null),[selected,setSelected]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[invitation,setInvitation]=useState('');
  const canEdit=can('write:sales');
  async function load() {const d=await api.get(`/partners/${partnerId}/workspace`);setData(d);setSelected(d.granted?.map(x=>x.id)||[]);}
  useEffect(()=>{let alive=true;setData(null);setError('');api.get(`/partners/${partnerId}/workspace`).then(d=>{if(alive){setData(d);setSelected(d.granted?.map(x=>x.id)||[]);}}).catch(e=>alive&&setError(e.message));return()=>{alive=false;};},[partnerId]);
  async function act(fn,message){setBusy(true);setError('');setNotice('');setInvitation('');try{await fn();await load();setNotice(message);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function invite(){if(!window.confirm('Rotate previous invitation links and issue a new 7-day link for the authorized events?'))return;setBusy(true);setError('');try{const r=await api.post(`/partners/${partnerId}/workspace/invite`,{});setInvitation(`${window.location.origin}${r.invitationPath}`);setNotice(`Invitation created for ${r.recipientEmail}. Copy it and send securely.`);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="panel partner-workspace-management" aria-label="Partner workspace management">
    <div className="page-heading"><div><p className="eyebrow">Client 360 · Partner access</p><h2>Partner Workspace</h2><p className="note-text">Authorized event details, explicit file sharing and partner requests. Client invoices, agreements and unshared files remain private.</p></div></div>
    {error&&<p role="alert" className="toast error">{error}</p>}{notice&&<p role="status" className="toast">{notice}</p>}
    {!data ? <p>Loading workspace access…</p> : !data.workspace ? <><p>This partner does not have a workspace.</p>{canEdit&&<button className="primary-action" disabled={busy||data.partner.status!=='ACTIVE'||!data.partner.email} onClick={()=>act(()=>api.post(`/partners/${partnerId}/workspace`,{}),'Workspace created. Choose authorized events before inviting.')}>Create Partner Workspace</button>}{!data.partner.email&&<p>Set the partner email before creating a workspace.</p>}</> : <>
      <p><strong>Status:</strong> {data.workspace.status} · <strong>Contact:</strong> {data.workspace.contact_email}</p>
      {data.workspace.status!=='ACTIVE'?<p>This workspace is revoked. It cannot be accessed using previous invitations.</p>:<>
      <h3>Authorized events</h3><p>Access is restricted to events already associated with this partner. Changing selection revokes existing invitation links.</p>
      {data.available.length?data.available.map(e=><label key={e.id} className="check-row"><input type="checkbox" disabled={!canEdit||busy} checked={selected.includes(e.id)} onChange={event=>setSelected(cur=>event.target.checked?[...cur,e.id]:cur.filter(id=>id!==e.id))}/>{e.event_name} · {String(e.event_date||'').slice(0,10)} · {e.status}</label>):<p>No linked events. Associate an event with this partner first.</p>}
      <div className="button-row">{canEdit&&<button disabled={busy||JSON.stringify([...selected].sort())===JSON.stringify(data.granted.map(x=>x.id).sort())} onClick={()=>act(()=>api.put(`/partners/${partnerId}/workspace/events`,{eventIds:selected}),'Authorized events updated. Previous invitations revoked.')}>Save event access</button>}{canEdit&&<button className="primary-action" disabled={busy||!data.granted.length} onClick={invite}>Create invitation link</button>}{canEdit&&<button disabled={busy} onClick={()=>{if(window.confirm('Revoke this workspace and all invitations?'))act(()=>api.post(`/partners/${partnerId}/workspace/revoke`,{}),'Workspace access revoked.');}}>Revoke workspace</button>}</div>
      {invitation&&<div className="panel"><strong>One-time invitation link</strong><p>This link grants access to authorized event details and shared files for seven days. Copy it now; the token will not be shown again.</p><button type="button" onClick={()=>navigator.clipboard.writeText(invitation)}>Copy invitation link</button></div>}
      <PartnerWorkspaceReview partnerId={partnerId} events={data.granted} editable={canEdit}/></>}
    </>}
  </section>;
}
