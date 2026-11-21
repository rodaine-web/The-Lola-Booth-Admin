import {useEffect,useRef,useState} from 'react';
const API=import.meta.env.VITE_API_URL||'/api';
export default function KeepsakesPostcardPreview({access,productId,variantId,recipient,index,artworkColor}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[updating,setUpdating]=useState(false),[retry,setRetry]=useState(0),current=useRef('');
 const body=JSON.stringify({productId,variantId,message:recipient?.message||'',messageFont:recipient?.messageFont||'classic',messageColor:recipient?.messageColor||'#26221d',postcardArtworkColor:artworkColor});
 useEffect(()=>{
  const abort=new AbortController();setUpdating(true);setError('');
  const timer=setTimeout(async()=>{
   try{
    const response=await fetch(`${API}/keepsakes${access}/postcard-preview`,{method:'POST',credentials:'omit',signal:abort.signal,headers:{'Content-Type':'application/json'},body});
    if(!response.ok){const result=await response.json();throw Error(result.error?.message||'The preview is temporarily unavailable.');}
    const blob=await response.blob();if(abort.signal.aborted)return;
    const next=URL.createObjectURL(blob);if(current.current)URL.revokeObjectURL(current.current);current.current=next;setUrl(next);
   }catch(e){if(e.name!=='AbortError'){setError(e.message);setUrl('');}}
   finally{if(!abort.signal.aborted)setUpdating(false);}
  },450);
  return()=>{clearTimeout(timer);abort.abort();};
 },[access,body,retry]);
 useEffect(()=>()=>{if(current.current)URL.revokeObjectURL(current.current);},[]);
 return <section className="ks-postcard-design" aria-label="Personalized postcard back"><h3>Back preview · Recipient {index+1}</h3>{url?<img src={url} alt="Approved Lola postcard back with your selected artwork color and note"/>:<div className="ks-postcard-loading">{error?'Preview unavailable':'Preparing your postcard…'}</div>}{updating&&<p role="status">Updating preview…</p>}{error&&<p role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Retry preview</button></p>}<p>The right-hand mailing area stays white. Lob adds the address, postage and barcode. The QR code stays black.</p></section>;
}
