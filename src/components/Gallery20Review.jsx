import {useEffect,useState} from 'react';
import '../styles/gallery20.css';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
import GalleryThumbnail from './GalleryThumbnail.jsx';

const displayStatus = {MATCHED:'Matched',REVIEW_REQUIRED:'Review match',PHOTO_MISSING:'Photo not imported',AMBIGUOUS:'Ambiguous filename',CONFLICT:'Conflicting assignments'};
export default function Gallery20Review({albumId, onUpdated}) {
  const {can}=useAuth();
  const [review,setReview]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [choices,setChoices]=useState({}),[filter,setFilter]=useState('ALL');
  async function load(){setLoading(true);setError('');try{setReview(await api.get(`/gallery-admin/albums/${albumId}/gallery20-review`));}catch(e){setError(e.message);}finally{setLoading(false);}}
  useEffect(()=>{let active=true;setReview(null);setLoading(true);api.get(`/gallery-admin/albums/${albumId}/gallery20-review`).then(r=>{if(active)setReview(r)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false};},[albumId]);
  async function match(item,index){const selected=choices[`${item.personId}:${item.filename}`]||item.candidateIds[0];if(!selected||busy)return;setBusy(true);setNotice('');setError('');try{
    // Use the existing audited, permission-gated assignment endpoint. Never publish here.
    await api.post(`/gallery-admin/albums/${albumId}/media/bulk`,{action:'assign',person_id:item.personId,media_ids:[selected]});
    setNotice('Assignment saved. Review the match again before publishing.');await load();await onUpdated?.();
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  const rows=(review?.records||[]).filter(r=>filter==='ALL'||r.status===filter);
  return <section className="g20-review" aria-label="Fiesta capture review">
    <div className="g20-header"><div><h3>Fiesta capture matching</h3><p>Exact original filenames only. No facial recognition or automatic guest access is triggered by this review.</p></div><button type="button" disabled={loading||busy} onClick={load}>Refresh matches</button></div>
    {loading&&<p role="status">Loading match review…</p>}
    {error&&<p role="alert" className="g20-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {review&&<>
      <div className="g20-metrics"><div><strong>{review.stats.photos}</strong><span>Photos</span></div><div><strong>{review.stats.sharingRecords}</strong><span>Sharing records</span></div><div><strong>{review.stats.matched}</strong><span>Matched</span></div><div><strong>{review.stats.pending}</strong><span>Pending</span></div><div><strong>{review.stats.ambiguous}</strong><span>Ambiguous/conflicting</span></div></div>
      <p className="g20-privacy">Private by default. Matching alone does not issue personal gallery links, send email/SMS, or publish photos.</p>
      <div className="g20-filter"><label>Show <select value={filter} onChange={e=>setFilter(e.target.value)}>{[['ALL','All records'],...Object.entries(displayStatus)].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="g20-rows">{rows.map((r,i)=><article className="g20-row" key={`${r.personId}:${r.filename}`}>
        <div><strong>{r.filename}</strong><small>{r.guest} · {displayStatus[r.status]}</small></div>
        <div className="g20-candidates">{r.candidateIds.length>0&&<><GalleryThumbnail id={choices[`${r.personId}:${r.filename}`]||r.candidateIds[0]} alt="Candidate capture"/><small>{r.candidateCount} candidate{r.candidateCount!==1?'s':''}</small></>}{r.candidateIds.length>1&&<select aria-label={`Choose photo for ${r.filename}`} value={choices[`${r.personId}:${r.filename}`]||r.candidateIds[0]} onChange={e=>setChoices(v=>({...v,[`${r.personId}:${r.filename}`]:e.target.value}))}>{r.candidateIds.map((id,j)=><option key={id} value={id}>Capture {j+1}</option>)}</select>}</div>
        {can('write:operations')&&!review.album.published_at&&r.candidateIds.length>0&&r.status!=='MATCHED'&&<button type="button" disabled={busy} onClick={()=>match(r,i)}>Confirm assignment</button>}
      </article>)}{!rows.length&&<p className="g20-empty">No matching records in this filter.</p>}</div>
      <div className="g20-postcards"><strong>Optional physical postcards: not enabled</strong><p>{review.postcard.reason}</p><p>Fiesta sharing CSV emails and phone numbers are not postal addresses. No Lob submissions are made.</p></div>
    </>}
  </section>;
}
