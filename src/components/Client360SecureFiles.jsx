import { useEffect, useMemo, useState } from "react";
import { FileText, Image as ImageIcon, Download, Eye, Upload, X, RefreshCw } from "lucide-react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

const supported = new Set(["image/png","image/jpeg","application/pdf"]);
const size = (v) => v == null ? "" : `${(Number(v)/1024/1024).toFixed(2)} MB`;
export default function Client360SecureFiles({records=[],selectedEventId,clientId,onUpdated}) {
  const {can} = useAuth();
  const allowed = can("read:sales");
  const canUpload = can("write:events");
  const [filter,setFilter] = useState("all");
  const [search,setSearch] = useState("");
  const [selected,setSelected] = useState(null);
  const [preview,setPreview] = useState(null);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [file,setFile] = useState(null);
  const [busy,setBusy] = useState(false);
  const [uploaded,setUploaded] = useState([]);
  const rows=useMemo(()=>{
    const map=new Map();
    for(const f of [...records,...uploaded]) if(f?.id && f.client_id===clientId && (!f.event_id || f.event_id===selectedEventId))map.set(f.id,f);
    return [...map.values()].filter(f=>(filter==="all"|| (filter==="event"?Boolean(f.event_id):!f.event_id)) && String(f.filename||"").toLowerCase().includes(search.toLowerCase()));
  },[records,uploaded,clientId,selectedEventId,filter,search]);
  useEffect(()=>{setSelected(null);setPreview(null);setUploaded([]);setFile(null);setError("");setNotice("");},[selectedEventId,clientId]);
  useEffect(()=>()=>{if(preview?.url)URL.revokeObjectURL(preview.url);},[preview]);
  async function openPreview(f){
    if(!supported.has(f.mime_type))return;
    setError("");setSelected(f);setBusy(true);
    try{const blob=await api.blob(`/client360-files/${f.id}/content`);setPreview({id:f.id,url:URL.createObjectURL(blob),type:f.mime_type});}
    catch(e){setError(e.message||"Preview unavailable.");setSelected(null);}
    finally{setBusy(false);}
  }
  async function save(e){
    e.preventDefault();if(!file||!selectedEventId||!clientId||busy)return;
    setError("");setNotice("");setBusy(true);
    try{
      if(!supported.has(file.type) || !file.size || file.size>8*1024*1024)throw new Error("Choose a PNG, JPG, or PDF smaller than 8 MB.");
      const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("Unable to read file."));reader.readAsDataURL(file);});
      const created=await api.post("/client360-files/upload",{client_id:clientId,event_id:selectedEventId,filename:file.name,mime_type:file.type,base64:encoded});
      setUploaded(v=>[created,...v]);setFile(null);setNotice("Document uploaded privately. Use Share with client when ready.");await onUpdated?.();
    }catch(e){setError(e.message||"Upload failed.");}finally{setBusy(false);}
  }
  if(!allowed)return <p className="c360-p4-empty">You do not have permission to view client documents.</p>;
  return <div className="c360-f4-stack">
    <div className="c360-f4-header"><div><strong>{rows.length} file{rows.length===1?"":"s"}</strong><p>Private, permission-checked documents associated with this client and selected event.</p></div>
      <div className="c360-f4-filters"><input aria-label="Find a document" placeholder="Search file names" value={search} onChange={e=>setSearch(e.target.value)}/>
      <select aria-label="File scope" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All matching files</option><option value="event">This event</option><option value="client">Client-wide</option></select></div></div>
    {error&&<p role="alert" className="c360-p4-error">{error}</p>}{notice&&<p role="status" className="c360-p4-notice">{notice}</p>}
    <div className="c360-f4-list">{rows.map(f=><div key={f.id} className="c360-f4-row"><div className="c360-f4-fileicon">{f.mime_type?.startsWith("image/")?<ImageIcon size={20}/>:<FileText size={20}/>}</div><div className="c360-f4-detail"><strong>{f.filename||"Unnamed document"}</strong><small>{[f.event_id?"Event":"Client-wide",f.category, f.visibility||"Internal",size(f.size_bytes)].filter(Boolean).join(" · ")}</small></div><div className="c360-f4-actions">{can('write:operations')&&f.event_id&&f.canShareWithClient&&<button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api.post(`/events/${f.event_id}/files/${f.id}/customer-access`,{shared:!f.customer_shared_at});setUploaded(old=>old.filter(row=>row.id!==f.id));await onUpdated?.();setNotice(f.customer_shared_at?'Client access removed.':'File shared in the client workspace.');}catch(error){setError(error.message);}finally{setBusy(false);}}}>{f.customer_shared_at?'Remove client access':'Share with client'}</button>}{supported.has(f.mime_type)&&<button type="button" disabled={busy} onClick={()=>openPreview(f)}><Eye size={14}/> Preview</button>}<button type="button" disabled={busy} onClick={()=>api.download(`/client360-files/${f.id}/download`,f.filename||"document").catch(e=>setError(e.message))}><Download size={14}/> Download</button></div></div>)}{!rows.length&&<p className="c360-p4-empty">No matching documents.</p>}</div>
    {canUpload&&selectedEventId&&clientId&&<form onSubmit={save} className="c360-f4-upload"><div><strong>Upload event document</strong><p>PNG, JPG, or PDF up to 8 MB. Uploads stay private until you choose Share with client. No email is sent.</p></div><input aria-label="Choose document" type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)} disabled={busy}/><button type="submit" className="primary-action" disabled={!file||busy}><Upload size={15}/>{busy?"Uploading…":"Upload privately"}</button></form>}
    <p className="c360-f4-footnote">Sharing and removal of client access are recorded in the audit history. Files are served through authenticated API endpoints, not public storage URLs.</p>
    {selected&&preview&&preview.id===selected.id&&<div className="c360-f4-overlay" role="presentation" onClick={()=>{setSelected(null);setPreview(null);}}><section className="c360-f4-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${selected.filename}`} onClick={e=>e.stopPropagation()}><header><strong>{selected.filename}</strong><button type="button" aria-label="Close preview" onClick={()=>{setSelected(null);setPreview(null);}}><X size={19}/></button></header>{preview.type==="application/pdf"?<iframe title="PDF document preview" src={preview.url} sandbox="allow-scripts"/>:<img alt={selected.filename||"Document preview"} src={preview.url}/>}<footer><button type="button" onClick={()=>api.download(`/client360-files/${selected.id}/download`,selected.filename||"document").catch(e=>setError(e.message))}><Download size={15}/> Download</button></footer></section></div>}
  </div>;
}
