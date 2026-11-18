import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
import '../styles/lob-print-ready-test.css';
const BASE='/gallery-admin/albums/';
function Preview({albumId,postcardId,side}){
 const [url,setUrl]=useState('');const [error,setError]=useState('');
 useEffect(()=>{let active=true,obj;api.blob(`${BASE}${albumId}/postcards/${postcardId}/print-preview/${side}`).then(b=>{if(active){obj=URL.createObjectURL(b);setUrl(obj)}}).catch(e=>active&&setError(e.message));return()=>{active=false;if(obj)URL.revokeObjectURL(obj)}},[albumId,postcardId,side]);
 return <div className="lob-proof-side"><strong>{side==='front'?'Fiesta photo — front':'Personalized address proof'}</strong>{url?<img src={url} alt={`${side} print-ready postcard preview`}/>:<p>{error||'Rendering preview…'}</p>}</div>;
}
export default function LobPrintReadyTest({album,rows,onRefresh}){
 const [open,setOpen]=useState(''),[agreed,setAgreed]=useState({}),[busy,setBusy]=useState(''),[err,setErr]=useState(''),[message,setMessage]=useState(''),[proof,setProof]=useState({});
 const cards=rows.filter(r=>r.front_url?.startsWith('gallery-media:')&&r.back_url?.startsWith('gallery-artwork:'));
 async function action(id,fn){setBusy(id);setErr('');setMessage('');try{await fn();await onRefresh?.();}catch(e){setErr(e.message||'Action failed.')}finally{setBusy('')}}
 return <section className="panel lob-print-ready-test"><h2>Lob print-ready proofs · Test mode</h2>
 <p>Generate private 4×6 previews and verify the photo, QR artwork, address clear zone and recipient before sending a test request. <strong>No physical mail will be sent.</strong></p>
 <p className="inline-notice">This QA transport never creates public photo URLs. Lob receives the photo and back as multipart file uploads. Live API keys are rejected.</p>
 {cards.map(r=><article key={r.id} className="lob-test-card"><div className="lob-test-card-header"><div><strong>{r.recipient_label}</strong><small> {r.status} {r.lob_postcard_id?`· ${r.lob_postcard_id}`:''}</small></div><button type="button" className="secondary-action" onClick={()=>setOpen(old=>old===r.id?'':r.id)}>{open===r.id?'Hide':'Preview'} front and back</button></div>
 {open===r.id&&<><div className="lob-proof-grid"><Preview albumId={album.id} postcardId={r.id} side="front"/><Preview albumId={album.id} postcardId={r.id} side="back"/></div><p className="note-text">The Lob test PDF is authoritative for final address and postage placement. Inspect the proof after submission. This preview includes the recipient address and reserved postage/barcode areas; these are proof guides, not an actual postage label.</p></>}
 <p>Approve this personalized proof and queue it in Mailing authorization below.</p>
 {r.status==='SUBMITTED_TEST'&&<button className="secondary-action" disabled={!!busy} onClick={()=>action(r.id,async()=>{const p=await api.get(`${BASE}${album.id}/postcards/${r.id}/lob-test-proof`);setProof(v=>({...v,[r.id]:p}));setMessage(`Lob status: ${p.status}`);})}>Get Lob test proof</button>}
 {proof[r.id]&&<div className="lob-test-proof-result">Render status: {proof[r.id].status}. {proof[r.id].url?<a href={proof[r.id].url} target="_blank" rel="noreferrer">Open short-lived PDF proof</a>:<span>Proof is still rendering.</span>}</div>}
 {r.status==='FAILED'&&<p className="unified-error">Submission status needs manual investigation. Do not retry until Lob records have been reconciled.</p>}
 </article>)}
 {!cards.length&&<p className="note-text">No personalized postcards are prepared yet. Complete Fiesta matching and draft approval above.</p>}
 {err&&<p role="alert" className="unified-error">{err}</p>}{message&&<p role="status" className="unified-ok">{message}</p>}
 </section>;
}
