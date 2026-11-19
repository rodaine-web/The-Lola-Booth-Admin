import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../api/client.js';
export default function GalleryPostcardClientSummary({eventId}){
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setData(null);setError('');api.get(`/gallery-admin/events/${eventId}/postcards-overview`).then(v=>{if(live)setData(v)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false};},[eventId]);
 if(error)return <p className="note-text">Postcard summary unavailable: {error}</p>;
 if(!data)return <p className="note-text">Loading postcard readiness…</p>;
 return <section className="panel gpc-client-summary"><h3>Optional Lob postcards</h3><p>Admin-only workflow linked to the existing event gallery. Live fulfillment remains disabled.</p><div className="gpc-stats"><div><strong>{data.total}</strong><span>Postcards</span></div><div><strong>{data.drafts}</strong><span>Drafts</span></div><div><strong>{data.approved}</strong><span>Approved</span></div><div><strong>{data.submitted_test}</strong><span>Lob TEST</span></div></div>{data.album_id&&<Link to={`/operations/galleries/${data.album_id}`}>Manage gallery postcards</Link>}</section>;
}
