// Browser-only product visualizations. Supplier photography supplies the actual
// frame rails and mug geometry. No guest photo is sent to a mockup vendor.
export function drawPrintLayout(context, image, spec={}, crop={}) {
 const w=context.canvas.width,h=context.canvas.height,sw=image.naturalWidth||image.width,sh=image.naturalHeight||image.height;
 context.fillStyle='#ffffff';context.fillRect(0,0,w,h);
 if(crop.fit==='cover'){
  let cw=sw,ch=sw/(w/h);if(ch>sh){ch=sh;cw=sh*w/h;}
  cw/=crop.zoom||1;ch/=crop.zoom||1;
  context.drawImage(image,(sw-cw)*(crop.x??.5),(sh-ch)*(crop.y??.5),cw,ch,0,0,w,h);
 }else{
  const px=(Number(spec.bleedPx||0)+Number(spec.safePx||0))/(spec.widthPx||w)*w;
  const py=(Number(spec.bleedPx||0)+Number(spec.safePx||0))/(spec.heightPx||h)*h;
  const scale=Math.min((w-2*px)/sw,(h-2*py)/sh),dw=sw*scale,dh=sh*scale;
  context.drawImage(image,px+(w-2*px-dw)*(crop.x??.5),py+(h-2*py-dh)*(crop.y??.5),dw,dh);
 }
}
export function printTexture(image,spec,crop){
 const canvas=document.createElement('canvas'),ratio=(spec?.heightPx||image.naturalHeight)/(spec?.widthPx||image.naturalWidth);canvas.width=Math.max(1,Math.round(Math.min(900,1200/ratio)));canvas.height=Math.max(1,Math.round(canvas.width*ratio));
 drawPrintLayout(canvas.getContext('2d'),image,spec,crop);return canvas;
}
export function drawFrame(context,texture,blank){
 // Nine-slice the official classic-frame rails, preserving its corners and
 // finish while adapting the aperture to the selected SKU's print ratio.
 const h=550,w=h*texture.width/texture.height,b=24,x=(1000-w)/2,y=(750-h)/2;
 context.save();context.shadowColor='#3d302c33';context.shadowBlur=25;context.shadowOffsetY=15;
 context.fillStyle='#252525';context.fillRect(x-b,y-b,w+2*b,h+2*b);context.restore();
 context.drawImage(texture,x,y,w,h);
 const gold=blank.naturalWidth===2000;
 const sx=gold?[456,508,1488,1536]:[475,565,1935,2025],sy=gold?[284,332,1624,1672]:[190,280,2220,2310],dx=[x-b,x,x+w,x+w+b],dy=[y-b,y,y+h,y+h+b];
 for(let row=0;row<3;row++)for(let col=0;col<3;col++)if(row!==1||col!==1)context.drawImage(blank,sx[col],sy[row],sx[col+1]-sx[col],sy[row+1]-sy[row],dx[col],dy[row],dx[col+1]-dx[col],dy[row+1]-dy[row]);
}
export function drawMug(context,texture,blank){
 const x=125,y=0,size=750;context.drawImage(blank,x,y,size,size);
 // Project the central visible half of the full wrap onto the real cylinder.
 const center=.499,r=.255,cx=x+center*size,radius=r*size;
 context.save();
 for(let dx=Math.ceil(cx-radius);dx<Math.floor(cx+radius);dx++){
  const a=Math.asin(Math.max(-1,(dx-cx)/radius)),b=Math.asin(Math.min(1,(dx+1-cx)/radius));
  const top=y+(.235-.045*(1-Math.cos((a+b)/2)))*size,dh=.59*size;
  const u=.5+a/(2*Math.PI),uw=(b-a)/(2*Math.PI);
  context.drawImage(texture,u*texture.width,0,uw*texture.width,texture.height,dx,top,1,dh);
  context.fillStyle=`rgba(0,0,0,${(1-Math.cos((a+b)/2))*.22})`;context.fillRect(dx,top,1,dh);
 }
 context.restore();
}
export function drawPaper(context,texture,{x=220,y=100,width=560,angle=0}={}){
 const height=width*texture.height/texture.width;context.save();context.translate(x+width/2,y+height/2);context.rotate(angle);
 context.shadowColor='#42372b33';context.shadowBlur=20;context.shadowOffsetY=12;context.fillStyle='#fff';context.fillRect(-width/2-5,-height/2-5,width+10,height+10);context.shadowColor='transparent';context.drawImage(texture,-width/2,-height/2,width,height);context.restore();
}
