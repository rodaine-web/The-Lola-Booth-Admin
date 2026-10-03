import {createCanvas,loadImage} from '@napi-rs/canvas';

// PDF pages need print-sized images, not the full-resolution camera originals.
export async function compactProposalImage(buffer) {
  const image=await loadImage(buffer);
  const scale=Math.min(1,1200/Math.max(image.width,image.height));
  const canvas=createCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
  const context=canvas.getContext('2d');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const result=canvas.toBuffer('image/jpeg',75);
  return result.length<buffer.length?result:buffer;
}

export async function compactProposalPhotos(proposal) {
  const cache=new Map();
  async function compact(uri){
    if(!/^data:image\/(jpeg|png);base64,/.test(uri||''))return uri;
    if(!cache.has(uri))cache.set(uri,(async()=>{
      const buffer=Buffer.from(uri.split(',')[1],'base64');
      const output=await compactProposalImage(buffer);
      const mime=output===buffer?uri.slice(5,uri.indexOf(';')):'image/jpeg';
      return `data:${mime};base64,${output.toString('base64')}`;
    })());
    return cache.get(uri);
  }
  const selected_experiences=[];
  for(const item of proposal.selected_experiences||[]){
    const visuals={...item.visuals};
    for(const key of Object.keys(visuals))if(typeof visuals[key]==='string')visuals[key]=await compact(visuals[key]);
    selected_experiences.push({...item,visuals});
  }
  const visual_sections=[];
  for(const section of proposal.visual_sections||[]){
    const images=[];
    for(const image of section.images||[])images.push({...image,dataUri:await compact(image.dataUri)});
    visual_sections.push({...section,images});
  }
  return {...proposal,selected_experiences,visual_sections};
}
