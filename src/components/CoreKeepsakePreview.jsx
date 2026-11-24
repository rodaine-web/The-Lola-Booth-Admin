import {useEffect,useRef,useState} from 'react';
import {useKeepsakesPhotos} from '../contexts/KeepsakesPhotos.jsx';
import {drawFrame,drawPaper,printTexture} from '../utils/keepsakes-preview.js';
const load=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src;});
function panel(ctx,photo,x,y,w,h,border=12,color='#e1d9cd'){
 ctx.save();ctx.shadowColor='#30261855';ctx.shadowBlur=16;ctx.shadowOffsetY=10;ctx.fillStyle=color;ctx.fillRect(x-border,y-border,w+2*border,h+2*border);ctx.shadowColor='transparent';
 const texture=printTexture(photo,{widthPx:w,heightPx:h},{fit:'contain'});ctx.drawImage(texture,x,y,w,h);ctx.restore();
}
export default function CoreKeepsakePreview({product,asset,strip,second,back=false,illustrative=false}){
 const {loadPhoto}=useKeepsakesPhotos()||{},ref=useRef(null),[state,setState]=useState('loading');
 useEffect(()=>{let active=true;setState('loading');
  if(!asset&&!illustrative){setState('unavailable');return;}
  Promise.all([illustrative?load('/assets/keepsakes/approved/'+(product.key==='edited-strip'?'sample-strip.svg':'sample-photo.webp')):loadPhoto(asset).then(load),product.key==='framed-photo'?load('/assets/keepsakes/prodigi-classic-frame-gold.png'):null,product.key==='postcard'?load('/assets/keepsakes/lola-postcard-back-v2.svg'):null,illustrative&&product.key==='edited-package'?load('/assets/keepsakes/approved/sample-strip.svg'):strip?loadPhoto(strip).then(load):null,illustrative&&product.key==='photo-book'?load('/assets/keepsakes/approved/sample-photo.webp'):second?loadPhoto(second).then(load):null]).then(([photo,frame,postcard,stripPhoto,secondPhoto])=>{
   if(!active||!ref.current)return;const c=ref.current.getContext('2d');c.setTransform(illustrative?1:2,0,0,illustrative?1:2,0,0);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.clearRect(0,0,1000,750);
   const bg=c.createLinearGradient(0,0,1000,750);bg.addColorStop(0,'#eee4d5');bg.addColorStop(1,'#faf6ef');c.fillStyle=bg;c.fillRect(0,0,1000,750);
   const ratio=photo.width/photo.height,w=ratio>=1?570:400,h=ratio>=1?570/ratio:Math.min(540,400/ratio),x=(1000-w)/2,y=(750-h)/2;
   if(frame)drawFrame(c,printTexture(photo,{widthPx:800,heightPx:1000},{fit:'contain'}),frame);
   else if(product.key==='postcard'){if(back)drawPaper(c,postcard,{x:100,y:100,width:800});else{drawPaper(c,postcard,{x:460,y:240,width:440,angle:.05});drawPaper(c,printTexture(photo,{widthPx:1800,heightPx:1200},{fit:'contain'}),{x:70,y:100,width:600,angle:-.04});}}
   else if(product.key==='keychain'){
    c.strokeStyle='#b48a50';c.lineWidth=18;c.beginPath();c.ellipse(500,145,58,58,0,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(500,200);c.lineTo(500,260);c.stroke();panel(c,photo,365,260,270,340,16,'#d6b77a');
   }else if(product.key==='magnet'){panel(c,photo,275,160,450,430,10,'#242322');}
   else if(['acrylic-display','premium-acrylic'].includes(product.key)){
    c.fillStyle='#bec9c677';c.beginPath();c.moveTo(x+w+15,y-15);c.lineTo(x+w+60,y+20);c.lineTo(x+w+60,y+h+40);c.lineTo(x+w+15,y+h+15);c.closePath();c.fill();panel(c,photo,x,y,w,h,15,'#e4eeec');c.strokeStyle='#fff';c.lineWidth=4;c.strokeRect(x-15,y-15,w+30,h+30);
   }else if(product.key==='jacketed-print'){c.fillStyle='#ded1bb';c.fillRect(170,130,330,490);c.fillStyle='#fdf9ef';c.fillRect(500,130,330,490);panel(c,photo,530,175,270,390,5,'#fff');}
   else if(product.key==='photo-book'){c.fillStyle='#26221d';c.fillRect(135,140,730,470);panel(c,photo,165,170,320,410,0);if(secondPhoto)panel(c,secondPhoto,515,170,320,410,0);else{c.fillStyle='#fffdf9';c.fillRect(515,170,320,410);c.fillStyle='#817164';c.font='22px Georgia';c.fillText('Choose another photo',555,370);}c.fillStyle='#d6c9b9';c.fillRect(493,140,14,470);}
   else if(product.key==='metal-print'){panel(c,photo,x,y,w,h,6,'#969c9d');}
   else if(product.key==='edited-strip'){drawPaper(c,photo,{x:350,y:75,width:Math.min(300,600*photo.width/photo.height)});}
   else if(product.key==='edited-package'){drawPaper(c,photo,{x:150,y:90,width:Math.min(470,560*photo.width/photo.height),angle:-.03});if(stripPhoto)drawPaper(c,stripPhoto,{x:690,y:90,width:Math.min(200,560*stripPhoto.width/stripPhoto.height),angle:.03});}
   else{drawPaper(c,photo,{x,y,width:w});}
   setState('ready');
  }).catch(()=>{if(active)setState('unavailable');});return()=>{active=false;};
 },[product.key,asset?.id,strip?.id,second?.id,back,illustrative,loadPhoto]);
 return <div className="shop-own-preview" data-preview-state={state} data-photo-id={asset?.id||''}><canvas width={illustrative?1000:2000} height={illustrative?750:1500} ref={ref} hidden={state!=='ready'} role="img" aria-label={`${illustrative?'Illustrative product example:':'Your photo on'} ${product.title}`}/>{state==='ready'&&<small className="shop-preview-disclosure">{illustrative?'Design illustration · sample photography pending':'Photo placement illustration · review final product proof'}</small>}{state!=='ready'&&<p role="status">{state==='loading'?'Preparing your keepsake…':'Your photo preview is unavailable.'}</p>}</div>;
}
