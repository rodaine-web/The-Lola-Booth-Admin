import {useEffect,useState} from 'react';
import {formatDateOnly} from '../utils/display.js';
function Capture({eventId,media,apiOrigin,onError}){
 const [src,setSrc]=useState('');
 useEffect(()=>{let alive=true,url;fetch(`${apiOrigin}/client/events/${eventId}/gallery/media/${media.id}`,{credentials:'include',cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('Capture preview unavailable. Refresh or sign in again.');url=URL.createObjectURL(await response.blob());if(alive)setSrc(url);else URL.revokeObjectURL(url);}).catch(error=>{if(alive)onError(error.message);});return()=>{alive=false;if(url)URL.revokeObjectURL(url);};},[eventId,media.id,apiOrigin]);
 return src?(media.mediaType==='VIDEO'?<video controls playsInline preload="metadata" src={src} aria-label={media.filename}/>:<img src={src} alt="Your event capture" loading="lazy"/>):<p>Loading capture…</p>;
}
export default function CustomerGallery({eventId,apiOrigin,onDownload}){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[error,setError]=useState(''),[page,setPage]=useState(0);
 useEffect(()=>{setOpen(false);setData(null);setError('');setPage(0);},[eventId]);
 async function load(){setError('');try{const r=await fetch(`${apiOrigin}/client/events/${eventId}/gallery`,{credentials:'include',cache:'no-store'});if(!r.ok)throw Error('Your gallery is not published, has expired, or needs a fresh sign-in. Contact LOLA for help.');setData(await r.json());setOpen(true);}catch(e){setError(e.message);}}
 return <><p>View your full event gallery after LOLA publishes it.</p><button className="workspace-text-action" onClick={load}>View gallery →</button>{error&&<p role="alert">{error}</p>}{open&&data&&<div><p>Available through {formatDateOnly(data.expiresAt)}.</p>{data.allowZip&&<button onClick={()=>onDownload('/gallery/zip')}>Download event ZIP</button>}<div className="customer-photo-grid">{data.media.slice(page*12,page*12+12).map(media=><article key={media.id}><Capture eventId={eventId} media={media} apiOrigin={apiOrigin} onError={setError}/>{data.allowDownload&&<button onClick={()=>onDownload(`/gallery/media/${media.id}/download`)}>Download {media.mediaType==='VIDEO'?'video':'photo'}</button>}</article>)}</div><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><button disabled={(page+1)*12>=data.media.length} onClick={()=>setPage(p=>p+1)}>Next</button><button onClick={()=>setOpen(false)}>Close gallery</button></div>}</>;
}
