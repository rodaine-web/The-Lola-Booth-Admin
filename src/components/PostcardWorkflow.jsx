import {useEffect,useState} from 'react';
import {api} from '../api/client.js';

const template='File Name,Recipient Name,Address Line 1,Address Line 2,City,State,ZIP,Country,Mail Consent,Consent Source\n';
export default function PostcardWorkflow({album,data,onPostcardsChanged}){
 const [rows,setRows]=useState([]),[summary,setSummary]=useState({}),[csv,setCsv]=useState(''),[front,setFront]=useState(''),[back,setBack]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[selected,setSelected]=useState([]),[choice,setChoice]=useState({});
 const base=`/gallery-admin/albums/${album.id}`;
 async function load(){const r=await api.get(`${base}/postcard-recipients`);setRows(r.data||[]);setSummary(r.summary||{});await onPostcardsChanged?.();}
 useEffect(()=>{let active=true;api.get(`${base}/postcard-recipients`).then(r=>{if(active){setRows(r.data||[]);setSummary(r.summary||{});}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false};},[album.id]);
 async function run(callback,success){if(busy)return;setBusy(true);setError('');setNotice('');try{await callback();setNotice(success);await load();}catch(e){setError(e.message||'Request failed.');}finally{setBusy(false);}}
 const photoChoices=(data.media||[]).filter(m=>m.status==='VISIBLE'&&m.media_type==='IMAGE');
 const eligible=rows.filter(r=>r.status==='MATCHED'&&r.consent&&!r.postcard_id);
 function resolveChoice(r){const ids=(r.filename&&photoChoices.filter(m=>m.filename===r.filename))||[];return ids;}
 return <div className="gpc-workflow">
  <section className="panel"><div className="overview-heading"><div><h2>Mailing survey · import & review</h2><p>Import a separate, permissioned postal-address CSV from Fiesta or another approved survey. This is <strong>not</strong> the six-column Fiesta photo-sharing CSV.</p></div><a className="secondary-action" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="LOLA-Postcard-Recipient-Template.csv">CSV template</a></div>
   <p className="inline-notice">A YES value must reflect explicit physical-mail consent. Importing never sends mail, creates a gallery link, or submits to Lob. Imported addresses are encrypted; only masked labels appear in this queue.</p>
   <form onSubmit={e=>{e.preventDefault();run(async()=>{await api.post(`${base}/postcard-recipients/import`,{csv});setCsv('');},'Recipient file reviewed and imported; no postcards sent.');}}><label>Mailing recipient CSV<input type="file" accept=".csv,text/csv" required onChange={async e=>{const f=e.target.files?.[0];setCsv('');if(!f)return;if(f.size>512*1024){setError('CSV must be at most 512 KB.');return;}setCsv(await f.text());}} /></label><button className="primary-action" disabled={busy||!csv} type="submit">Import and match</button></form>
   <div className="gpc-stats">{[['Imported',summary.total],['Ready to prepare',summary.matched],['Missing photo',summary.unmatched],['Ambiguous',summary.ambiguous],['No consent',summary.noConsent],['Prepared',summary.prepared]].map(([name,value])=><div key={name}><strong>{value??0}</strong><span>{name}</span></div>)}</div>
  </section>
  <section className="panel"><h2>Recipient review</h2><p>Only uniquely matched, visible photos assigned to a single active guest are prepared automatically. Resolve ambiguous cases explicitly.</p>
   <div className="gpc-artwork"><label>Approved 4×6 front artwork URL<input type="url" value={front} onChange={e=>setFront(e.target.value)} placeholder="https://.../front.pdf" /></label><label>Approved 4×6 back artwork URL<input type="url" value={back} onChange={e=>setBack(e.target.value)} placeholder="https://.../back.pdf" /></label></div>
   {!rows.length&&<p className="note-text">No physical-mail recipient survey imported yet.</p>}
   <div className="table-wrap"><table><thead><tr><th>Capture filename</th><th>Masked recipient</th><th>Consent</th><th>Review status</th><th>Action</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.filename}</td><td>{r.recipient_label}</td><td>{r.consent?'Recorded':'Not provided'}</td><td>{r.status}</td><td>
    {eligible.some(x=>x.id===r.id)&&<button disabled={busy||!front||!back} onClick={()=>run(()=>api.post(`${base}/postcard-recipients/${r.id}/prepare`,{front_url:front,back_url:back}),'Draft prepared; not approved or submitted.')}>Prepare draft</button>}
    {r.consent&&!r.postcard_id&&['AMBIGUOUS','UNMATCHED'].includes(r.status)&&<div className="gpc-resolution"><select aria-label={`Guest for ${r.filename}`} value={choice[r.id]?.person||''} onChange={e=>setChoice(old=>({...old,[r.id]:{...old[r.id],person:e.target.value}}))}><option value="">Select guest</option>{(data.people||[]).filter(p=>p.status==='ACTIVE').map(p=><option key={p.id} value={p.id}>{p.display_name}</option>)}</select><select aria-label={`Photo for ${r.filename}`} value={choice[r.id]?.media||''} onChange={e=>setChoice(old=>({...old,[r.id]:{...old[r.id],media:e.target.value}}))}><option value="">Select assigned photo</option>{resolveChoice(r).map(m=><option key={m.id} value={m.id}>{m.filename}</option>)}</select><button disabled={busy||!choice[r.id]?.person||!choice[r.id]?.media} onClick={()=>run(()=>api.post(`${base}/postcard-recipients/${r.id}/resolve`,{person_id:choice[r.id].person,media_id:choice[r.id].media}),'Recipient match confirmed.')}>Confirm match</button></div>}
    {r.status==='NO_CONSENT'&&<small>Blocked—no physical-mail consent</small>}{r.status==='PREPARED'&&<small>Draft created</small>}
   </td></tr>)}</tbody></table></div>
  </section>
  {error&&<p role="alert" className="gpc-error">{error}</p>}{notice&&<p role="status" className="gpc-notice">{notice}</p>}
 </div>;
}

export function PostcardBatchTools({album,rows,onUpdated}){
 const [selected,setSelected]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const drafts=rows.filter(r=>r.status==='DRAFT');
 useEffect(()=>{setSelected(list=>list.filter(id=>drafts.some(r=>r.id===id)));},[rows]);
 async function approve(){if(!selected.length||busy)return;setBusy(true);setError('');setNotice('');try{const r=await api.post(`/gallery-admin/albums/${album.id}/postcards/approve-batch`,{postcard_ids:selected});setSelected([]);setNotice(`${r.approved} draft postcards approved. No mail submitted.`);await onUpdated();}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="panel gpc-batch"><h3>Batch approval</h3><p>Select up to 50 prepared drafts after reviewing their front/back artwork and mailing consent above. Approval does not send mail.</p>{drafts.length===0?<p className="note-text">No drafts awaiting approval.</p>:<><label><input type="checkbox" checked={drafts.length>0&&drafts.every(r=>selected.includes(r.id))} onChange={e=>setSelected(e.target.checked?drafts.slice(0,50).map(r=>r.id):[])} /> Select first {Math.min(drafts.length,50)} drafts</label><div className="gpc-batch-list">{drafts.slice(0,50).map(r=><label key={r.id}><input type="checkbox" checked={selected.includes(r.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,r.id].slice(0,50):old.filter(id=>id!==r.id))}/>{r.recipient_label} · 4×6 <a href={r.front_url} target="_blank" rel="noreferrer">Front</a> <a href={r.back_url} target="_blank" rel="noreferrer">Back</a></label>)}</div><button disabled={busy||!selected.length} onClick={approve}>Approve {selected.length} selected drafts</button></>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</section>;
}
