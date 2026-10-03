import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {compactProposalImage,compactProposalPhotos} from '../server/src/services/proposal-pdf-images.js';
import {brandedEmailHtml} from '../server/src/services/automation-service.js';
import {generateProposalPdf} from '../server/src/services/document-service.js';
import fs from 'node:fs';
import vm from 'node:vm';

function photo(){
 const canvas=createCanvas(2400,1800),ctx=canvas.getContext('2d');
 const pixels=ctx.createImageData(canvas.width,canvas.height);
 let seed=12;
 for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}
 ctx.putImageData(pixels,0,0);return canvas.toBuffer('image/jpeg',95);
}
test('proposal photos shrink to print dimensions without changing saved originals',async()=>{
 const original=photo(),out=await compactProposalImage(original),image=await loadImage(out);
 assert.equal(image.width,1200);assert.equal(image.height,900);assert.ok(out.length<original.length/4);
 const uri='data:image/jpeg;base64,'+original.toString('base64');
 const proposal={selected_experiences:[{name:'Lola Glam',visuals:{hero:uri}}],visual_sections:[{images:[{dataUri:uri,alt:'Glam booth'}]}]};
 const compact=await compactProposalPhotos(proposal);
 assert.equal(proposal.selected_experiences[0].visuals.hero,uri);
 assert.equal(compact.selected_experiences[0].visuals.hero,compact.visual_sections[0].images[0].dataUri);
 const pdf=await generateProposalPdf({...compact,proposal_type:'PRIVATE_EVENT',client_name:'Compression QA',pricing_snapshot:{total:899},line_items_snapshot:[]});
 assert.ok(pdf.length<3*1024*1024,`PDF was ${pdf.length} bytes`);
});
test('HTML proposal email exposes review and download actions without payment copy',()=>{
 const html=brandedEmailHtml('Review your proposal.',{ctaLabel:'View Your Proposal',ctaUrl:'https://staging.thelolabooth.com/proposal/qa',secondaryCta:{label:'Download PDF',url:'https://staging.thelolabooth.com/proposal/qa?download=pdf',copyLabel:'Or download your proposal PDF:'}});
 assert.match(html,/View Your Proposal/);assert.match(html,/Download PDF/);assert.match(html,/qa\?download=pdf/);assert.doesNotMatch(html,/payment link/);
});
test('website PDF email action downloads only after secure proposal loads',async()=>{
 const source=fs.readFileSync('public/staging-site/proposal.html','utf8').split('<script>')[1].split('</script>')[0];
 for(const ok of [true,false]){
  const elements=new Map();const assigned=[];
  const context={URLSearchParams,window:{LOLA_CONFIG:{apiBase:'https://stagingapi.thelolabooth.com'}},location:{search:'?download=pdf',pathname:'/proposal/qa-token',assign:url=>assigned.push(url)},document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{style:{},className:'',value:'',textContent:''});return elements.get(id);}},fetch:async()=>({ok,json:async()=>({proposal:{status:'SENT',proposal_number:'QA'}}),text:async()=>'<p>Proposal</p>'})};
  vm.runInNewContext(source,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(assigned,ok?['https://stagingapi.thelolabooth.com/api/public/proposals/qa-token/pdf']:[]);
 }
});
