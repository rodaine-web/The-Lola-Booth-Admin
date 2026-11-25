import {useEffect,useRef,useState} from 'react';
import {drawFrame,drawMug,drawPaper,printTexture} from '../utils/keepsakes-preview.js';
import '../styles/keepsakes-product-preview.css';
const API=import.meta.env.VITE_API_URL||'/api';
const mediaUrl=url=>url?.startsWith('/api/')?API.replace(/\/api$/,'')+url:url;
const load=url=>new Promise((resolve,reject)=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Preview unavailable'));image.src=url;});
export function canPreviewKeepsake(product,variant=product?.variants?.[0]){
 if(variant?.sku==='GLOBAL-CFP-12X16'&&!['black','white','gold'].includes(variant.attributes?.color||'black'))return false;
 return product?.provider==='DIGITAL'||product?.provider==='LOB'&&variant?.backTemplate==='lola-connect-v2'
  ||product?.provider==='PRODIGI'&&['GLOBAL-MUG-W','GLOBAL-PHO-4X6','GLOBAL-CFP-12X16'].includes(variant?.sku);
}
export default function KeepsakesProductPreview({product,asset,variant,crop,compact=false}){
 const canvas=useRef(null),[status,setStatus]=useState('loading'),[backVisible,setBackVisible]=useState(false);
 const finish=variant?.attributes?.color||'black';
 const spec=JSON.stringify(variant?.printSpec||{}),customization=JSON.stringify(crop||{}),sku=variant?.sku,kind=String(product?.category||'').toLowerCase(),src=mediaUrl(asset?.url);
 useEffect(()=>{
  let active=true;setStatus('loading');
  const frame=kind==='frame'&&sku==='GLOBAL-CFP-12X16',mug=kind==='mug'&&sku==='GLOBAL-MUG-W';
  const blank=frame?`/assets/keepsakes/prodigi-classic-frame-${['black','white','gold'].includes(finish)?finish:'black'}.png`:mug?'/assets/keepsakes/prodigi-white-mug-11oz.png':null;
  if(!src){setStatus('unavailable');return;}
  Promise.all([load(src),blank?load(blank):null,kind==='postcard'?load('/assets/keepsakes/lola-postcard-back-v2.svg'):null]).then(([photo,template,back])=>{
   if(!active||!canvas.current)return;
   const context=canvas.current.getContext('2d'),printSpec=JSON.parse(spec),texture=printTexture(photo,printSpec,JSON.parse(customization));
   context.clearRect(0,0,1000,750);context.fillStyle='#f1ebe1';context.fillRect(0,0,1000,750);
   if(frame)drawFrame(context,texture,template);
   else if(mug)drawMug(context,texture,template);
   else if(kind==='postcard'&&backVisible){drawPaper(context,back,{x:100,y:100,width:800});}
   else if(kind==='postcard'){
    drawPaper(context,back,{x:450,y:240,width:440,angle:.08});drawPaper(context,texture,{x:95,y:145,width:560,angle:-.06});
   }else if(kind==='bundle'||kind==='digital_bundle'){
    drawPaper(context,texture,{x:255,y:120,width:360,angle:.08});drawPaper(context,texture,{x:220,y:95,width:360,angle:-.08});
   }else{
    const width=Math.min(620,530*texture.width/texture.height);drawPaper(context,texture,{x:(1000-width)/2,y:(750-width*texture.height/texture.width)/2,width});
   }
   setStatus('ready');
  }).catch(()=>{if(active)setStatus('unavailable');});
  return()=>{active=false;};
 },[src,sku,kind,finish,spec,customization,backVisible]);
 return <div className={`kp-preview ${compact?'kp-compact':''}`} data-preview-state={status} data-product-kind={kind}>
  <canvas ref={canvas} width="1000" height="750" role="img" aria-label={`${asset?.label||'Your photo'} on ${product?.title||'your keepsake'}`} hidden={status!=='ready'}/>
  {status!=='ready'&&<div className="kp-placeholder" role="status">{status==='loading'?'Preparing your personalized preview…':'Your photo preview is unavailable. Please try again.'}</div>}
  {compact&&kind==='postcard'&&status==='ready'&&<button className="kp-flip" type="button" onClick={()=>setBackVisible(value=>!value)} aria-pressed={backVisible}>{backVisible?'View front':'View back'}</button>}
  {!compact&&status==='ready'&&<p>Product visualization · review your saved print layout before payment</p>}
 </div>;
}
