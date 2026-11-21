import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {renderKeepsakesArtwork} from '../server/src/services/keepsakes-artwork.js';
import {keepsakesProofDescriptors, keepsakesQuoteProof, renderKeepsakesProofThumbnail} from '../server/src/services/keepsakes-proof-service.js';

const quoteId = '11111111-1111-4111-8111-111111111111';
const source = (width,height,color) => sharp({create: {width,height,channels:3,background:color}}).png().toBuffer();

test('proof thumbnails preserve all four distinct print edges while reducing dimensions and stripping metadata', async () => {
  const image = await sharp(await source(2400,1600,'#ffffff')).composite([
    {input:await source(2400,80,'#ff0000'),left:0,top:0},
    {input:await source(2400,80,'#0000ff'),left:0,top:1520},
    {input:await source(80,1440,'#00ff00'),left:0,top:80},
    {input:await source(80,1440,'#ffff00'),left:2320,top:80}
  ]).withMetadata({density:300}).png().toBuffer();
  const output = await renderKeepsakesProofThumbnail(image), metadata = await sharp(output).metadata();
  assert.equal(metadata.width,1200); assert.equal(metadata.height,800); assert.equal(metadata.format,'jpeg');
  assert.equal(metadata.exif,undefined); assert.equal(metadata.icc,undefined); assert.notEqual(metadata.density,300);
  const {data,info} = await sharp(output).raw().toBuffer({resolveWithObject:true});
  const near = (x,y,expected) => {
    const pixel = [...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
    pixel.forEach((value,n)=>assert.ok(Math.abs(value-expected[n])<12,`${x},${y} channel ${n}: ${pixel}`));
  };
  near(600,10,[255,0,0]); near(600,790,[0,0,255]); near(10,400,[0,255,0]); near(1190,400,[255,255,0]);
});

test('proof derivative uses the actual safe-layout artwork rather than recropping its composite', async () => {
  const image = await sharp(await source(240,160,'#008800')).composite([
    {input:await source(20,160,'#ff0000'),left:0,top:0},
    {input:await source(20,160,'#0000ff'),left:220,top:0}
  ]).png().toBuffer();
  const actual = await renderKeepsakesArtwork({bytes:image,spec:{widthPx:120,heightPx:120,dpi:300,bleedPx:2,safePx:3}});
  const proof = await renderKeepsakesProofThumbnail(actual.buffer), metadata = await sharp(proof).metadata();
  assert.equal(metadata.width,120); assert.equal(metadata.height,120);
  const {data,info} = await sharp(proof).raw().toBuffer({resolveWithObject:true});
  const pixel = (x,y)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
  assert.ok(pixel(8,60)[0]>235); assert.ok(pixel(111,60)[2]>235);
  assert.ok(pixel(60,2).every(c=>c>240));
});

test('proof descriptors include each physical front and separate recipient messages, never digital originals', () => {
  const items = [
    {product:{provider:'PRODIGI',title:'Mug'}},
    {product:{provider:'LOB',title:'Postcard'},recipients:[{message:'One'},{message:'Two'}]},
    {product:{provider:'DIGITAL',title:'Original'}}
  ];
  const proofs=keepsakesProofDescriptors('photo','authorized-capability',quoteId,items);
  assert.deepEqual(proofs.map(p=>[p.itemIndex,p.side,p.recipientIndex]),[[0,'front',0],[1,'front',0],[1,'back',0],[1,'back',1]]);
  assert.equal(proofs[3].url,`/api/keepsakes/access/photo/authorized-capability/quotes/${quoteId}/proofs/1/back/1`);
  assert.match(proofs[2].label,/printer adds address and postage/);
  assert.equal(JSON.stringify(proofs).includes('One'),false);
});

test('invalid proof inputs are rejected before touching storage, credentials or the database', async () => {
  for (const input of [{itemIndex:-1,side:'front'},{itemIndex:0.5,side:'front'},{itemIndex:0,side:'raw'},{itemIndex:0,side:'back',recipientIndex:-1}]) {
    await assert.rejects(keepsakesQuoteProof('photo','token',quoteId,input),{code:'KEEPSAKES_PROOF_UNAVAILABLE'});
  }
  await assert.rejects(keepsakesQuoteProof('photo','token','invalid',{itemIndex:0,side:'front'}),{code:'KEEPSAKES_PROOF_UNAVAILABLE'});
  await assert.rejects(renderKeepsakesProofThumbnail('https://example.test/raw-original'),{code:'KEEPSAKES_PROOF_UNAVAILABLE'});
  assert.throws(()=>keepsakesProofDescriptors('unknown','token',quoteId,[]),{code:'KEEPSAKES_PROOF_UNAVAILABLE'});
});
