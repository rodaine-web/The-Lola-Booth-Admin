import GalleryLiveMailing from './GalleryLiveMailing.jsx';
import GalleryMailingWorkbench from './GalleryMailingWorkbench.jsx';
import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
import GalleryThumbnail from './GalleryThumbnail.jsx';
import UnifiedPostcardWorkflow,{BackPreview} from './UnifiedPostcardWorkflow.jsx';
import LobPrintReadyTest from './LobPrintReadyTest.jsx';
import '../styles/gallery-postcards.css';
import '../styles/postcard-workflow.css';
export default function GalleryPostcards({album,data}){
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState([]);
 async function load(){const r=await api.get(`/gallery-admin/albums/${album.id}/postcards`);setRows(r.data||[])}
 useEffect(()=>{load().catch(e=>setError(e.message));},[album.id]);
 async function action(fn,success){if(busy)return;setBusy(true);setError('');setMessage('');try{await fn();await load();setMessage(success)}catch(e){setError(e.message||'Operation failed.')}finally{setBusy(false)}}
 return <section className="gallery-postcards">
  <section className="panel"><div className="overview-heading"><div><h2>Postcards · Lob</h2><p>Event-specific photo postcards: Fiesta matched front, shared approved back, recipient consent and secure review.</p></div><strong>{rows.length} draft/order record{rows.length===1?'':'s'}</strong></div><p className="inline-notice">Local QA only. No import, artwork upload, draft creation or approval sends mail. Lob live mailing remains disabled.</p></section>
  <UnifiedPostcardWorkflow album={album} data={data} onUpdated={load}/>
  <LobPrintReadyTest album={album} rows={rows} onRefresh={load}/><GalleryMailingWorkbench album={album} rows={rows} onRefresh={load}/>
  <GalleryLiveMailing album={album} rows={rows}/>
  <section className="panel"><h2>4. Review &amp; approve drafts</h2><p>Preview each guest's exact Fiesta photo and the uploaded approved postcard back before selecting for batch approval. Approving a draft does not send mail.</p>
  {rows.filter(r=>r.status==='DRAFT').length>0&&<label><input type="checkbox" checked={rows.filter(r=>r.status==='DRAFT').slice(0,50).every(r=>selected.includes(r.id))} onChange={e=>setSelected(e.target.checked?rows.filter(r=>r.status==='DRAFT').slice(0,50).map(r=>r.id):[])} /> Select first {Math.min(50,rows.filter(r=>r.status==='DRAFT').length)} drafts</label>}
  <div className="unified-drafts">{rows.filter(r=>r.status==='DRAFT').map(r=><div className="unified-draft" key={r.id}><label><input type="checkbox" checked={selected.includes(r.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,r.id].slice(0,50):old.filter(id=>id!==r.id))}/>{r.recipient_label}</label><div className="unified-proof"><div><GalleryThumbnail id={r.media_id} alt="Fiesta-matched postcard front"/><small>Front — exact Fiesta photo</small></div><div>{r.back_url?.startsWith('gallery-artwork:')?<BackPreview albumId={album.id} artworkId={r.back_url.slice('gallery-artwork:'.length)}/>:<small>Legacy back URL: preview unavailable</small>}<small>Back — approved design; address/postage overlaid by Lob when submitted</small></div></div></div>)}</div>
  <button disabled={busy||!selected.length} className="primary-action" onClick={()=>action(async()=>{await api.post(`/gallery-admin/albums/${album.id}/postcards/approve-batch`,{postcard_ids:selected});setSelected([]);},'Drafts approved for QA; no Lob request made.')}>Approve {selected.length} selected draft{selected.length===1?'':'s'}</button></section>
  <section className="panel"><h2>5. Postcard status</h2>{!rows.length&&<p className="note-text">No postcards prepared yet. Import Fiesta data, upload the approved back and select recipients above.</p>}{rows.map(r=><article key={r.id} className="unified-recipient"><GalleryThumbnail id={r.media_id} alt="Personalized postcard front"/><div><strong>{r.recipient_label}</strong><small>{r.status} · Front: guest photo · Back: {r.back_url?.startsWith('gallery-artwork:')?'Uploaded approved event back':'Legacy artwork'}</small><small>{r.lob_postcard_id?`Lob test ID: ${r.lob_postcard_id}`:''}</small>{r.front_url?.startsWith('gallery-media:')&&<p className="note-text">Internal proof only. Use personalized proof approval and the authorized test queue above.</p>}{r.status==='SUBMITTED_TEST'&&<button disabled={busy} onClick={()=>action(()=>api.post(`/gallery-admin/albums/${album.id}/postcards/${r.id}/refresh-test`,{}),'Test status refreshed.')}>Refresh Lob test status</button>}{r.status==='APPROVED'&&!r.front_url?.startsWith('gallery-media:')&&<p>Legacy URL draft: rebuild using the private photo and approved back.</p>}</div></article>)}</section>
  {error&&<p role="alert" className="unified-error">{error}</p>}{message&&<p role="status" className="unified-ok">{message}</p>}
 </section>;
}
