import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {STAGING_SHOP_ORIGIN,isStagingShopHost,keepsakesPublicOrigin} from '../shared/keepsakes-host.js';
import {galleryOriginAllowed} from '../shared/environment-isolation.js';
test('staging shop resolves to the store and can never authorize production or Admin origins',async()=>{
 assert.equal(isStagingShopHost('stagingshop.thelolabooth.com'),true);assert.equal(isStagingShopHost('shop.thelolabooth.com'),false);assert.equal(isStagingShopHost('stagingshop.thelolabooth.com.evil.example'),false);
 assert.equal(keepsakesPublicOrigin({APP_ENV:'staging',GALLERY_PUBLIC_ORIGIN:'https://staginggallery.thelolabooth.com'}),'https://staginggallery.thelolabooth.com');
 assert.equal(galleryOriginAllowed('production',STAGING_SHOP_ORIGIN,'/api/keepsakes/catalogue'),false);
 const v=JSON.parse(await fs.readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.ok(v.redirects.some(r=>r.source==='/'&&r.destination==='/shop'&&r.has?.some(h=>h.type==='host'&&h.value==='stagingshop.thelolabooth.com')));
 assert.ok(v.headers.some(r=>r.has?.some(h=>h.value==='stagingshop.thelolabooth.com')&&r.headers.some(h=>h.key==='X-Robots-Tag'&&h.value.includes('noindex'))));
});
