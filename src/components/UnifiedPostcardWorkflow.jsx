import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
import GalleryThumbnail from './GalleryThumbnail.jsx';
import '../styles/unified-postcards.css';

const fileBase64 = file => new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('File read failed.'));reader.readAsDataURL(file);});
export default function UnifiedPostcardWorkflow({album,data,onUpdated}){
 const {can}=useAuth();const canReview=can('write:operations');
 const base=`/gallery-admin/albums/${album.id}`;
 const [review,setReview]=useState({data:[],needsReview:0}),[correction,setCorrection]=useState(null),[usOnly,setUsOnly]=useState(false);
 const [rows,setRows]=useState([]),[summary,setSummary]=useState({}),[artworks,setArtworks]=useState([]),[chosenBack,setChosenBack]=useState(''),[selected,setSelected]=useState([]),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[notice,setNotice]=useState('');
 async function load(){const [recs,arts,survey]=await Promise.all([api.get(`${base}/postcard-recipients`),api.get(`${base}/postcard-backs`),canReview?api.get(`${base}/fiesta-survey-review`):Promise.resolve({data:[],needsReview:0})]);setReview(survey);setRows(recs.data||[]);setSummary(recs.summary||{});setArtworks(arts.data||[]);await onUpdated?.();}
 useEffect(()=>{let active=true;Promise.all([api.get(`${base}/postcard-recipients`),api.get(`${base}/postcard-backs`),canReview?api.get(`${base}/fiesta-survey-review`):Promise.resolve({data:[],needsReview:0})]).then(([recs,arts,survey])=>{if(!active)return;setReview(survey);setRows(recs.data||[]);setSummary(recs.summary||{});setArtworks(arts.data||[]);}).catch(e=>{if(active)setErr(e.message)});return()=>{active=false;};},[album.id,canReview]);
 async function run(action,success){if(busy)return;setBusy(true);setErr('');setNotice('');try{const result=await action();await load();setNotice(typeof success==='function'?success(result):success);}catch(e){setErr(e.message||'Action failed.');}finally{setBusy(false);}}
 const eligible=rows.filter(r=>r.status==='MATCHED'&&r.consent&&!r.postcard_id&&r.media_id&&r.person_id);
 const approved=artworks.filter(a=>a.status==='APPROVED');
 const selectAll=eligible.length>0&&eligible.every(r=>selected.includes(r.id));
 return <div className="unified-postcards">
  <section className="panel"><div className="overview-heading"><div><h2>1. Fiesta recipient &amp; photo matching</h2><p>Uses the original Fiesta CSV imported in Gallery Settings. No second address CSV is required.</p></div><button disabled={busy} className="secondary-action" onClick={()=>run(()=>api.post(`${base}/postcard-recipients/reconcile`,{}),'Matches refreshed. No mail sent.')}>Refresh from Fiesta</button></div>
   <div className="unified-stats">{[['Imported',summary.total],['Ready',summary.matched],['Needs photo',summary.unmatched],['Ambiguous',summary.ambiguous],['No consent',summary.noConsent],['Drafted',summary.prepared]].map(([l,v])=><div key={l}><strong>{v??0}</strong><span>{l}</span></div>)}</div>
   <p className="inline-notice">Only exact Fiesta file matches with confirmed guest ownership, complete US address and explicit physical-mail consent are eligible. Importing never sends mail.</p>
  </section>
  {canReview&&<section className="panel" aria-label="Fiesta survey review"><h2>Survey import review ({review.needsReview})</h2>
   <p>Incomplete mailing answers are saved here. Correct the source answers and reimport the CSV below. Consent must reflect the guest’s actual answer. Original imports remain available for audit.</p>
   <p>Source downloads contain private guest details. They use plain text to avoid automatically executing spreadsheet formulas; open them in a text editor.</p>
   <form onSubmit={e=>{e.preventDefault();if(!correction||!album.external_event_id)return;run(async()=>{if(correction.size>1024*1024)throw Error('Use a Fiesta CSV up to 1 MB.');return api.post(`${base}/fiesta-shares`,{csv:await correction.text(),eventCode:album.external_event_id,...(usOnly?{defaultCountry:'US'}:{})});},r=>`Imported ${r.postalImported} recipients; ${r.postalNeedsReview} need review. No mail sent.`);}}>
    <label>Corrected Fiesta CSV<input type="file" accept=".csv,text/csv" onChange={e=>setCorrection(e.target.files?.[0]||null)}/></label>
    <label><input type="checkbox" checked={usOnly} onChange={e=>setUsOnly(e.target.checked)}/> US-only survey (country not collected)</label><p>This records US as the import country only when the survey omitted it. Explicit foreign addresses remain in review. Original answers are preserved.</p>
    <button disabled={busy||!correction||!album.external_event_id}>Reimport corrected answers</button>
   </form>
   {review.data.length===0?<p>No postal survey imports to review yet.</p>:<ul>{review.data.map(row=><li key={row.id}><strong>{row.filename}</strong> · source row {row.source_row} · {row.status.replaceAll('_',' ')}
    {row.issues.length>0&&<p>{row.issues.map(issue=>issue.replaceAll('_',' ').toLowerCase()).join('; ')}</p>}
    <button disabled={busy} type="button" onClick={()=>run(async()=>{const blob=await api.blob(`${base}/fiesta-survey-imports/${row.batch_id}/source`);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='fiesta-original-survey.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'Original source downloaded.')}>Download original import</button>
   </li>)}</ul>}
  </section>}
  <section className="panel"><h2>2. Upload the shared postcard back</h2><p>Upload the branded reverse artwork once. Use 1875 × 1275 px (landscape) or 1275 × 1875 px (portrait), JPG/PNG, including bleed. Leave the recipient address and postage areas blank. An administrator must check the Lob template manually before approving.</p>
   <form className="unified-upload" onSubmit={e=>{e.preventDefault();if(!file)return;run(async()=>api.post(`${base}/postcard-backs`,{filename:file.name,mime_type:file.type,base64:await fileBase64(file)}),'Artwork uploaded as a draft. Review it before approval.');}}><label>Postcard back artwork<input type="file" accept="image/jpeg,image/png" required onChange={e=>setFile(e.target.files?.[0]||null)}/></label><button disabled={busy||!file} className="primary-action">Upload back</button></form>
   <div className="unified-backs">{artworks.map(a=><article key={a.id}><BackPreview albumId={album.id} artworkId={a.id}/><div><strong>Back v{a.version}</strong><p>{a.original_filename} · {a.width_px}×{a.height_px} · {a.status}</p>{a.status==='DRAFT'&&<button disabled={busy} onClick={()=>run(()=>api.post(`${base}/postcard-backs/${a.id}/approve`,{}),'Back approved for QA draft preparation.')}>Approve this back</button>}</div></article>)}</div>
   {approved.length>0&&<label>Approved back for selected recipients<select value={chosenBack} onChange={e=>setChosenBack(e.target.value)}><option value="">Choose approved back</option>{approved.map(a=><option key={a.id} value={a.id}>Version {a.version} — {a.original_filename}</option>)}</select></label>}
  </section>
  <section className="panel"><h2>3. Select guests &amp; prepare personalized fronts</h2><p>Each checked guest gets their own Fiesta-matched photo as the front and the approved shared artwork as the back.</p>
   <label className="unified-selectall"><input type="checkbox" checked={selectAll} onChange={e=>setSelected(e.target.checked?eligible.map(r=>r.id):[])} /> Select all {eligible.length} eligible guests</label>
   <div className="unified-rows">{rows.map(r=><div key={r.id} className="unified-recipient"><input type="checkbox" aria-label={`Select ${r.filename}`} disabled={r.status!=='MATCHED'||!r.consent||Boolean(r.postcard_id)||!r.media_id||!r.person_id} checked={selected.includes(r.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,r.id]:old.filter(id=>id!==r.id))}/>{r.media_id?<GalleryThumbnail id={r.media_id} alt={`Fiesta capture ${r.filename}`}/>:<div className="unified-empty">No match</div>}<div><strong>{r.filename}</strong><small>{r.recipient_label} · {r.consent?'Consent recorded':'No physical-mail consent'} · {r.status}</small></div></div>)}</div>
   <button disabled={busy||!chosenBack||!selected.length} className="primary-action" onClick={()=>run(()=>api.post(`${base}/postcards/prepare-from-fiesta`,{back_artwork_id:chosenBack,recipient_ids:selected}),r=>{setSelected([]);return `${r.prepared} drafts prepared; ${r.skipped} skipped. No mail sent.`})}>Prepare {selected.length} personalized draft{selected.length===1?'':'s'}</button>
   <p className="inline-notice">Drafts use private gallery media and private back artwork. Review the personalized proof, approve mailing limits and use the test queue below. Live mailing remains disabled.</p>
  </section>
  {err&&<p role="alert" className="unified-error">{err}</p>}{notice&&<p role="status" className="unified-ok">{notice}</p>}
 </div>;
}
export function BackPreview({albumId,artworkId}){
 const [url,setUrl]=useState(null);
 useEffect(()=>{let active=true;let object;api.blob(`/gallery-admin/albums/${albumId}/postcard-backs/${artworkId}/media`).then(blob=>{if(active){object=URL.createObjectURL(blob);setUrl(object);}}).catch(()=>{});return()=>{active=false;if(object)URL.revokeObjectURL(object);};},[albumId,artworkId]);
 return url?<img className="unified-back-image" src={url} alt="Uploaded postcard back artwork"/>:<span className="unified-empty">Preview unavailable</span>;
}
