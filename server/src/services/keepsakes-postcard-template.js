import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {AppError} from '../utils/errors.js';
import {STANDARD_POSTCARD_SHA256,STANDARD_POSTCARD_QR} from '../../../shared/postcard-template.js';

export async function standardPostcardBack(){
 const bytes=await fs.readFile(new URL('../assets/keepsakes/lola-postcard-back-v2.png',import.meta.url));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==STANDARD_POSTCARD_SHA256)throw new AppError('The approved postcard template changed.',503,'KEEPSAKES_TEMPLATE_INTEGRITY');
 return bytes;
}

export async function themeStandardPostcard(bytes,color='#111111'){
 if(!/^#[0-9a-f]{6}$/i.test(color)||crypto.createHash('sha256').update(bytes).digest('hex')!==STANDARD_POSTCARD_SHA256)throw new AppError('Choose a valid color for the approved postcard back.',422,'KEEPSAKES_TEMPLATE_INVALID');
 const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),q=STANDARD_POSTCARD_QR;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  if(x>=q.x&&x<q.x+q.width&&y>=q.y&&y<q.y+q.height)continue;
  const i=(y*info.width+x)*3,light=Math.max(0,Math.min(1,((data[i]+data[i+1]+data[i+2])/3-17)/238));
  for(let c=0;c<3;c++)data[i+c]=Math.round(255*light+rgb[c]*(1-light));
 }
 return sharp(data,{raw:info}).png().toBuffer();
}
