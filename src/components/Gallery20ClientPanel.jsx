import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
import Gallery20Review from './Gallery20Review.jsx';
import GalleryPostcardClientSummary from './GalleryPostcardClientSummary.jsx';

export default function Gallery20ClientPanel({eventId}) {
 const {can}=useAuth();const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 async function load(){setLoading(true);setError('');try{setData(await api.get(`/gallery-admin/events/${eventId}/gallery20-overview`));}catch(e){setError(e.message);}finally{setLoading(false);}}
 useEffect(()=>{let active=true;setData(null);setLoading(true);setError('');api.get(`/gallery-admin/events/${eventId}/gallery20-overview`).then(r=>{if(active)setData(r)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false};},[eventId]);
 async function create(){if(busy)return;setBusy(true);setError('');try{await api.post('/gallery-admin/albums',{event_id:eventId});await load();}catch(e){setError(e.message)}finally{setBusy(false)}}
 if(!can('read:events'))return <p>Gallery access is restricted.</p>;
 return <div className="g20-client">{loading&&<p role="status">Loading event gallery…</p>}{error&&<p role="alert" className="g20-error">{error}</p>}
 {!loading&&data&&!data.album&&<div className="g20-empty"><strong>No gallery created for this event</strong><p>Start a private album before importing Fiesta mappings and Dropbox photos.</p>{can('write:operations')&&<button className="primary-action" disabled={busy} onClick={create}>Create private gallery</button>}</div>}
 {data?.album&&<><div className="g20-metrics"><div><strong>{data.album.status}</strong><span>Gallery status</span></div><div><strong>{data.stats.photos}</strong><span>Photos</span></div><div><strong>{data.stats.matched}</strong><span>Matched</span></div><div><strong>{data.stats.pending}</strong><span>Pending</span></div><div><strong>{data.stats.ambiguous}</strong><span>Needs review</span></div></div><div className="g20-actions"><Link to={`/operations/galleries/${data.album.id}`}>Manage imports, access & publishing</Link><button type="button" onClick={load}>Refresh status</button></div><Gallery20Review albumId={data.album.id} onUpdated={load}/><GalleryPostcardClientSummary eventId={eventId}/></>}
 </div>;
}
