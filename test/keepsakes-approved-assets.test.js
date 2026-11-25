import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {APPROVED_KEEPSAKES_ASSETS,PRODUCT_IMAGE_IDS,productMarketingImage} from '../shared/keepsakes-product-assets.js';
import {KEEPSAKES_PREVIEW_TEMPLATES} from '../shared/keepsakes-preview-templates.js';
import {bulkCsvRows,BULK_COLUMNS,BULK_TEMPLATE} from '../shared/keepsakes-bulk.js';
test('all supplied originals retain their hashes and distinct construction mappings',async()=>{
 assert.equal(APPROVED_KEEPSAKES_ASSETS.length,19);
 for(const a of APPROVED_KEEPSAKES_ASSETS){const bytes=await fs.readFile(new URL('../public'+a.original,import.meta.url));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),a.sha256);assert.match(a.srcSet,/480w.*960w.*1254w/);assert.ok(a.alt);}
 assert.equal(productMarketingImage('jacketed-print').id,'photo-jacket');assert.equal(productMarketingImage('acrylic-display').id,'acrylic-insert');assert.equal(productMarketingImage('premium-acrylic').id,'uv-acrylic-mono');assert.ok(PRODUCT_IMAGE_IDS['framed-photo'].includes('frame-metal'));assert.equal(productMarketingImage('metal-print'),null);
 for(const t of Object.values(KEEPSAKES_PREVIEW_TEMPLATES)){assert.ok(APPROVED_KEEPSAKES_ASSETS.some(a=>a.id===t.assetId));for(const q of t.quads){assert.equal(q.length,4);assert.ok(q.flat().every(x=>Number.isFinite(x)&&x>=0&&x<=1254));}assert.ok(t.physicalAspectRatio>0);}
 assert.ok(KEEPSAKES_PREVIEW_TEMPLATES['photo-jacket'].cornerTabs>0);
});
test('bulk CSV accepts quoted cells as text and rejects missing columns and oversized batches',()=>{
 assert.deepEqual(bulkCsvRows(BULK_TEMPLATE),[]);const row=['"Guest, One"','guest@example.invalid','','photo-id','keychain','standard','1','123 Test St','','Chicago','IL','60601','US','"=not executed, simply text"'].join(',');const result=bulkCsvRows(BULK_TEMPLATE+row);assert.equal(result[0]['Recipient Name'],'Guest, One');assert.equal(result[0]['Optional Message'],'=not executed, simply text');assert.throws(()=>bulkCsvRows('Name,Email\nGuest,test@example.invalid'),/template/);assert.throws(()=>bulkCsvRows(BULK_COLUMNS.join(',')+'\n'+Array(101).fill(row).join('\n')),/100 recipient/);
});
