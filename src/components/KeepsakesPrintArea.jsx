import {useEffect,useRef,useState} from 'react';
import {useKeepsakesPhotos} from '../contexts/KeepsakesPhotos.jsx';
import {drawPrintLayout} from '../utils/keepsakes-preview.js';

// Exact, flat print area beside the product visualization. Uses the same fit,
// zoom and position as the server proof; the original remains private/unchanged.
export default function KeepsakesPrintArea({asset,variant,crop}){
 const {loadPhoto}=useKeepsakesPhotos(),canvas=useRef(null),[ready,setReady]=useState(false),[failed,setFailed]=useState(false),spec=variant.printSpec;
 useEffect(()=>{let active=true;setReady(false);setFailed(false);
  loadPhoto(asset).then(url=>new Promise((resolve,reject)=>{const photo=new Image();photo.onload=()=>resolve(photo);photo.onerror=reject;photo.src=url;})).then(photo=>{if(!active||!canvas.current)return;drawPrintLayout(canvas.current.getContext('2d'),photo,spec,crop);setReady(true);}).catch(()=>{if(active)setFailed(true);});
  return()=>{active=false;};
 },[asset.id,loadPhoto,spec.widthPx,spec.heightPx,spec.bleedPx,spec.safePx,JSON.stringify(crop)]);
 return <figure className="shop-print-area"><figcaption>Your print layout · {variant.dimensions}</figcaption><canvas ref={canvas} width={spec.widthPx} height={spec.heightPx} hidden={!ready} role="img" aria-label={`Your ${variant.dimensions} print layout`}/>{!ready&&<p role="status">{failed?'Print preview unavailable. Please try again.':'Preparing your print preview…'}</p>}<small>{crop.fit==='cover'?'Your selected crop fills the print area.':'Your whole photo is fitted inside the print area.'}</small></figure>;
}
