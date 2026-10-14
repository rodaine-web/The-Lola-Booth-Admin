import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
import DataTable from './DataTable.jsx';
import {DetailSection} from './WorkspaceUI.jsx';
import {EVENT_FILE_MAX_BYTES,EVENT_FILE_CATEGORIES,EVENT_FILE_MIME_TYPES,managesEventFiles} from '../../shared/event-files.js';

const bytes=value=>value==null?'Unknown':Number(value)>=1048576?`${(Number(value)/1048576).toFixed(1)} MB`:`${Math.ceil(Number(value)/1024)} KB`;
export default function EventFilesPanel({eventId}){
 const {can,user}=useAuth();
 const [files,setFiles]=useState(null),[file,setFile]=useState(null),[category,setCategory]=useState('OTHER'),[visibility,setVisibility]=useState('INTERNAL');
 const [busy,setBusy]=useState(false),[downloading,setDownloading]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const input=useRef(null),requestId=useRef(crypto.randomUUID());
 const [sharing,setSharing]=useState(null);
 useEffect(()=>{let active=true;api.get(`/events/${eventId}/files`).then(value=>{if(active)setFiles(value.data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[eventId]);
 async function refresh(){setError('');try{setFiles((await api.get(`/events/${eventId}/files`)).data);}catch(e){setError(e.message);}}
 function chooseFile(value){setFile(value);requestId.current=crypto.randomUUID();setError('');setNotice('');}
 async function upload(e){
  e.preventDefault();if(busy||!file)return;
  setError('');setNotice('');
  if(!EVENT_FILE_MIME_TYPES.includes(file.type)||!file.size||file.size>EVENT_FILE_MAX_BYTES){setError('Choose a PDF, PNG or JPEG file up to 8 MB.');return;}
  setBusy(true);
  try{
   const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('The file could not be read. Choose it again.'));reader.readAsDataURL(file);});
   await api.post(`/events/${eventId}/files`,{requestId:requestId.current,filename:file.name,mimeType:file.type,category,visibility,data});
   setNotice('Private file saved.');setFile(null);input.current.value='';requestId.current=crypto.randomUUID();await refresh();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function download(row){setDownloading(row.id);setError('');try{await api.download(`/events/${eventId}/files/${row.id}/download`,row.filename);}catch(e){setError(e.message);}finally{setDownloading(null);}}
 async function confirmSharing(){
  if(busy||!sharing)return;setBusy(true);setError('');setNotice('');
  try{await api.post(`/events/${eventId}/files/${sharing.id}/customer-access`,{shared:!sharing.customer_shared_at});setNotice(sharing.customer_shared_at?'Customer access removed. Already downloaded copies cannot be recalled.':'File shared in The Client Workspace. No email was sent.');setSharing(null);await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <DetailSection title="Event Files">
  <p>Files stay private to authorized team members unless Admin explicitly shares an eligible file in The Client Workspace. Internal and financial files cannot be shared here. A customer must be linked when the file is uploaded.</p>
  {error&&<p role="alert" className="toast error">{error}</p>}{notice&&<p role="status" className="toast">{notice}</p>}
  {can('write:events')&&managesEventFiles(user)&&<form onSubmit={upload} className="event-files-form">
   <label><span>File <span aria-hidden="true">*</span></span><input ref={input} aria-label="File" type="file" required accept="application/pdf,image/png,image/jpeg" disabled={busy} onChange={e=>chooseFile(e.target.files?.[0]||null)}/><small>PDF, PNG or JPEG · maximum 8 MB</small></label>
   <label><span>Category <span aria-hidden="true">*</span></span><select aria-label="Category" required value={category} disabled={busy} onChange={e=>{setCategory(e.target.value);requestId.current=crypto.randomUUID();}}>{EVENT_FILE_CATEGORIES.map(value=><option key={value} value={value}>{value.replaceAll('_',' ').toLowerCase()}</option>)}</select></label>
   <label><span>Team access <span aria-hidden="true">*</span></span><select aria-label="Team access" required value={visibility} disabled={busy} onChange={e=>{setVisibility(e.target.value);requestId.current=crypto.randomUUID();}}><option value="INTERNAL">Internal — Admin only</option><option value="PRIVATE">Private — assigned event team</option></select></label>
   <button className="primary-action" type="submit" disabled={busy||!file}>{busy?'Uploading…':'Upload File'}</button>
  </form>}
  <button type="button" disabled={busy} onClick={refresh}>Refresh files</button>
  {sharing&&<div className="event-file-sharing" role="region" aria-label="Confirm customer file access"><h3>{sharing.customer_shared_at?'Remove customer access?':'Share this file with the client?'}</h3><p>{sharing.filename}</p><p>{sharing.customer_shared_at?'This removes future access in The Client Workspace. It cannot recall downloaded copies.':'The customer for this event will be able to download this file after signing in. Review its contents before sharing. No email will be sent.'}</p><button disabled={busy} onClick={confirmSharing}>{sharing.customer_shared_at?'Remove customer access':'Confirm sharing'}</button><button disabled={busy} onClick={()=>setSharing(null)}>Cancel</button></div>}
  {files===null&&!error?<p role="status">Loading files…</p>:<DataTable rows={files||[]} columns={['filename','category','size_bytes','visibility','created_at','hasContent','customer_shared_at']} columnLabels={{size_bytes:'Size',hasContent:'Availability',customer_shared_at:'Customer access'}} empty="No files attached to this event." renderCell={(row,column)=>column==='customer_shared_at'?(row.customer_shared_at?'Shared':'Not shared'):column==='size_bytes'?bytes(row.size_bytes):column==='hasContent'?(row.hasContent?'Uploaded':'Details only'):null} rowActions={row=><div className="event-file-actions"><button type="button" disabled={!row.hasContent||downloading!==null} onClick={()=>download(row)} aria-label={`Download ${row.filename}`}>{downloading===row.id?'Downloading…':'Download'}</button>{can('write:events')&&managesEventFiles(user)&&<button type="button" disabled={busy||(!row.customer_shared_at&&!row.canShareWithClient)} onClick={()=>setSharing(row)} aria-label={`${row.customer_shared_at?'Stop sharing':'Share'} ${row.filename}`}>{row.customer_shared_at?'Stop sharing':'Share with client'}</button>}</div>}/>}
 </DetailSection>;
}
