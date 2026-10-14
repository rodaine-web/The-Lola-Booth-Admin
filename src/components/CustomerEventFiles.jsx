import {useEffect,useState} from 'react';
import {FileText,Download} from 'lucide-react';
import {formatDateOnly} from '../utils/display.js';

export default function CustomerEventFiles({eventId,apiOrigin,busy,onDownload}){
 const [files,setFiles]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setFiles(null);setError('');
  fetch(`${apiOrigin}/public/client/events/${eventId}/files`,{credentials:'include',signal:controller.signal}).then(async response=>{
   const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Files are temporarily unavailable.');
   if(!controller.signal.aborted)setFiles(result.data);
  }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[eventId,apiOrigin,reload]);
 return <section id="files" className="workspace-card workspace-shared-files" aria-label="Shared event files">
  <h2><FileText/>Event Files</h2><p>Documents and reference images shared by the LOLA team for this event.</p>
  {error?<><p role="alert">{error}</p><button disabled={busy} onClick={()=>setReload(value=>value+1)}>Retry files</button></>:files===null?<p role="status">Loading shared files…</p>:files.length?<ul>{files.map(file=><li key={file.id}><div><strong>{file.filename}</strong><p>{file.category.replaceAll('_',' ')} · Shared {formatDateOnly(file.sharedAt)}</p></div><button disabled={busy} onClick={()=>onDownload(`/files/${file.id}/download`,file.filename)} aria-label={`Download ${file.filename}`}><Download/>Download</button></li>)}</ul>:<p>No files have been shared yet. Your signed agreement, proposal, invoices and receipts are available in their sections above.</p>}
  <p className="workspace-file-help">Need to upload artwork or inspiration? <a href="#planning">Open Planning & Creative</a>.</p>
 </section>;
}
