import test from 'node:test';
import assert from 'node:assert/strict';
import {mappedProposalPhotos,proposalPhotoMapping,proposalPhotoKey,retainProposalPhotoSections} from '../shared/proposal-photo-mapping.js';
import {proposalHtml} from '../server/src/services/document-service.js';
const assets=Object.values(proposalPhotoMapping).flat().map(([prefix],index)=>({id:`asset-${index}`,filename:`${prefix}.orig.jpg`}));
test('each selected experience receives only its own reviewed photographs in semantic order',()=>{
 const sections=mappedProposalPhotos([{name:'Lola Glam'},{name:'Lola 360'},{name:'Digital Booth'}],assets,()=> 'section');
 assert.equal(sections.length,3);
 for(const [index,key] of ['glam','360','digital'].entries())assert.deepEqual(sections[index].media_ids,proposalPhotoMapping[key].map(([prefix])=>assets.find(asset=>asset.filename.startsWith(prefix)).id));
});
test('Vogue, audio and bespoke activations do not inherit Glam or platform photos',()=>{
 assert.deepEqual(mappedProposalPhotos([{name:'Lola Vogue'},{name:'Lola Audio Guestbook'},{name:'Corporate / Brand Activation'}],assets,()=> 'section'),[]);
 assert.equal(proposalPhotoKey('Unknown'),null);
});
test('incomplete library mappings do not shift equipment into hero or output slots',()=>{
 assert.deepEqual(mappedProposalPhotos([{name:'Lola Glam'}],assets.filter(asset=>!asset.filename.startsWith(proposalPhotoMapping.glam[0][0])),()=> 'section'),[]);
});
test('HTML includes approved image sections and renders hydrated raster images',()=>{
 const image='data:image/jpeg;base64,AAAA';
 const html=proposalHtml({selected_experiences:[{name:'Lola Glam',visuals:{hero:image}}],visual_sections:[{title:'Lola Glam · Experience photos',body:'Reviewed',images:[{dataUri:image,alt:'Glam booth'}]}]});
 assert.ok(html.includes(image));assert.ok(html.includes('Lola Glam · Experience photos'));
});
test('Digital and custom proposals no longer inherit Glam photography or audio-phone stories',()=>{
 const html=proposalHtml({selected_experiences:[{name:'Digital Booth'}]});
 assert.ok(html.includes('The Digital Booth'));
 assert.ok(!html.includes('The Phone'));
 assert.ok(!html.includes('https://thelolabooth.com/assets/glam.jpg'));
});

test('removing an experience removes its automatic photo section while preserving manually curated sections',()=>{
 const automatic=mappedProposalPhotos([{name:'Lola Glam'}],assets,()=> 'section');
 const manual={kind:'BOOTH',title:'Custom booth',body:'Client creative',media_ids:['custom']};
 assert.deepEqual(retainProposalPhotoSections([...automatic,manual],[{name:'Digital Booth'}]),[manual]);
 assert.deepEqual(retainProposalPhotoSections([...automatic,manual],[{name:'Lola Glam'}]),[...automatic,manual]);
});
