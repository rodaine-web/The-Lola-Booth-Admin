import {useDialogFocus} from "../utils/use-dialog-focus.js";
import AsyncState from '../components/AsyncState.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import {privilegeGroups,privilegeGroup,grantablePrivileges} from '../utils/privilege-groups.js';
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const blank = { first_name:'', last_name:'', email:'', phone:'', business_role:'', roles:['ATTENDANT'], permissions:[] };
export default function Users() {
  const {user:actor,can} = useAuth();
  const [loading,setLoading]=useState(true),[viewing,setViewing]=useState(null);
  const [users,setUsers]=useState([]),[roles,setRoles]=useState([]),[permissions,setPermissions]=useState([]);
  const [editing,setEditing]=useState(null),[form,setForm]=useState(blank),[search,setSearch]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  useDialogFocus(Boolean(editing),()=>setEditing(null));
  async function load(){setLoading(true);setError('');try{const [u,r,p]=await Promise.all([api.get('/users'),api.get('/roles'),api.get('/permissions')]);setUsers(u.data);setRoles(r.data);setPermissions(p.data);}finally{setLoading(false);}}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  const availableRoles=roles.filter(r=>r.name!=='ROOT'&&(r.name!=='OWNER'||actor.roles.includes('OWNER'))&&(!['ADMIN','SUPER_ADMIN'].includes(r.name)||actor.roles.some(x=>['OWNER','SUPER_ADMIN'].includes(x))));
  function manage(row){return row.id!==actor.id&&!row.roles.includes('ROOT')&&(!row.roles.includes('OWNER')||actor.roles.includes('OWNER'))&&(!row.roles.some(r=>['ADMIN','SUPER_ADMIN'].includes(r))||actor.roles.some(r=>['OWNER','SUPER_ADMIN'].includes(r)));}
  async function action(fn,message){setBusy(true);setError('');setNotice('');try{const result=await fn();setNotice(result?.deliveryError?`${message} Email could not be delivered. Retry the invitation or password reset action.`:message);await load();return true;}catch(e){setError(e.message);return false;}finally{setBusy(false);}}
  function edit(row){setForm({...blank,...row,first_name:row.first_name||row.name.split(' ')[0],last_name:row.last_name||row.name.split(' ').slice(1).join(' ')});setEditing(row.id);setError('');}
  function field(key,value){setForm(f=>({...f,[key]:value}));}
  function toggle(key,value){field(key,form[key].includes(value)?form[key].filter(x=>x!==value):[...form[key],value]);}
  async function save(e){e.preventDefault();const body={first_name:form.first_name,last_name:form.last_name,name:`${form.first_name} ${form.last_name}`.trim(),phone:form.phone||null,business_role:form.business_role||null};if(editing==='new')body.email=form.email;if(can('assign:roles')){body.roles=form.roles;body.permissions=form.permissions;}if(await action(()=>editing==='new'?api.post('/users',body):api.patch(`/users/${editing}`,body),editing==='new'?'User created and invitation requested.':'User updated.'))setEditing(null);}
  return <main className="page"><div className="page-heading"><div><p className="eyebrow">Access management</p><h1>Users</h1><p className="lede">Manage invitations, roles and additional privileges.</p></div>{can('create:users')&&<button data-dialog-trigger="user-create" className="primary-action" onClick={()=>{setForm({...blank});setEditing('new');}}>Create User</button>}</div>
    {error&&<AsyncState error={error} onRetry={()=>load().catch(e=>setError(e.message))} noun="users"/>}{notice&&<div role="status" className="toast">{notice}</div>}
    <div className="toolbar"><label>Search users<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name or email" /></label></div>
    {loading&&<AsyncState loading noun="users"/>}{!loading&&!users.length&&<AsyncState empty noun="users"/>}<div className="panel table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>Actions</th></tr></thead><tbody>{users.filter(u=>`${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase())).map(u=><tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.roles.join(', ')||'No role'}</td><td><StatusBadge status={u.active?u.invitation_status:'DISABLED'}/></td><td><div className="button-row">
      <button onClick={()=>setViewing(u)}>View</button>{manage(u)&&can('edit:users')&&<button disabled={busy} onClick={()=>edit(u)}>Edit</button>}
      {manage(u)&&can(u.active?'disable:users':'edit:users')&&<button disabled={busy} onClick={()=>action(()=>api.post(`/users/${u.id}/${u.active?'deactivate':'reactivate'}`,{}),u.active?'User deactivated.':'User reactivated.')}>{u.active?'Deactivate':'Reactivate'}</button>}
      {manage(u)&&u.active&&u.invitation_status!=='ACTIVE'&&can('invitations.send')&&<button disabled={busy} onClick={()=>action(()=>api.post(`/users/${u.id}/resend-invitation`,{}),'Invitation requested.')}>Resend invitation</button>}
      {manage(u)&&u.active&&can('password_resets.send')&&<button disabled={busy} onClick={()=>action(()=>api.post(`/users/${u.id}/password-reset`,{}),'Password reset email requested.')}>Password reset</button>}
      {u.id===actor.id&&<span>Your account</span>}
    </div></td></tr>)}</tbody></table></div>
    {viewing&&<section className="panel"><div className="table-heading"><h2>{viewing.name}</h2><button onClick={()=>setViewing(null)}>Close details</button></div><p>{viewing.email} · {viewing.phone||'No phone supplied'}</p><p>{viewing.business_role||'No business role'} · {viewing.roles.join(', ')}</p><StatusBadge status={viewing.active?viewing.invitation_status:'DISABLED'}/></section>}
    {editing&&<div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title"><form className="modal" onSubmit={save}><div className="modal-heading"><h2 id="user-dialog-title">{editing==='new'?'Create User':'Edit User'}</h2><button type="button" onClick={()=>setEditing(null)}>Close</button></div><div className="form-grid">
      {error&&<div role="alert" className="toast error wide">{error}</div>}
      <label>First Name<input required autoFocus value={form.first_name} onChange={e=>field('first_name',e.target.value)}/></label><label>Last Name<input required value={form.last_name} onChange={e=>field('last_name',e.target.value)}/></label>
      <label>Email<input required type="email" disabled={editing!=='new'} value={form.email} onChange={e=>field('email',e.target.value)}/></label><label>Phone (optional)<input type="tel" value={form.phone||''} onChange={e=>field('phone',e.target.value)}/></label><label>Business Role<input value={form.business_role||''} onChange={e=>field('business_role',e.target.value)}/></label>
      {can('assign:roles')&&<><fieldset className="wide"><legend>Roles</legend>{availableRoles.map(r=><label className="check-row" key={r.id}><input type="checkbox" checked={form.roles.includes(r.name)} onChange={()=>toggle('roles',r.name)}/><span>{r.name}</span></label>)}</fieldset>
      <details className="wide"><summary>Additional privileges ({form.permissions.length})</summary><p className="note-text">Roles supply inherited access. Additional privileges can only be granted within your own authority.</p>{privilegeGroups.map(group=>{const items=grantablePrivileges(permissions,actor).filter(p=>privilegeGroup(p.key)===group);return items.length>0&&<fieldset key={group}><legend>{group}</legend><div className="button-row"><button type="button" onClick={()=>field('permissions',[...new Set([...form.permissions,...items.map(p=>p.key)])])}>Select all in {group}</button><button type="button" onClick={()=>field('permissions',form.permissions.filter(k=>!items.some(p=>p.key===k)))}>Clear {group}</button></div><div className="form-grid">{items.map(p=><label className="check-row" key={p.key}><input type="checkbox" checked={form.permissions.includes(p.key)} onChange={()=>toggle('permissions',p.key)}/><span>{p.description||p.key.replace(/[:._]/g,' ')}</span></label>)}</div></fieldset>;})}</details></>}
    </div><p className="note-text">New users receive a personal, expiring setup link. No default password is assigned.</p><div className="modal-actions"><button type="button" onClick={()=>setEditing(null)}>Cancel</button><button className="primary-action" disabled={busy||!form.roles.length}>{busy?'Saving…':'Save'}</button></div></form></div>}
  </main>;
}
