import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {coreCatalogueView} from '../shared/keepsakes-core-catalogue.js';
import {DEFAULT_STATION_POLICY,quoteCelebrationStation} from '../shared/keepsake-station-policy.js';

test('Keepsakes Admin and gallery controls save explicit product/source permissions on desktop and mobile', {skip: process.env.KEEPSAKES_BROWSER_TEST !== 'true', timeout: 120000}, async () => {
  const output = path.join(os.tmpdir(), 'lola-keepsakes-admin-browser');
  await fs.mkdir(output, {recursive: true});
  const vite = await createServer({configFile: false, root: process.cwd(), cacheDir: path.join(os.tmpdir(), 'lola-keepsakes-admin-vite-cache'), plugins: [react(), {
    name: 'keepsakes-admin-fixture', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/keepsakes-admin-qa')) return next();
        res.setHeader('Content-Type', 'text/html');
        const component = req.url.includes('/station') ? 'React.createElement(StationQA)' : req.url.includes('/gallery') ? 'React.createElement(GalleryKeepsakes,{album:{id:"album-1"}})' : 'React.createElement(KeepsakesAdmin)';
        res.end(await server.transformIndexHtml(req.url, `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:20px;background:#f8f5ef;font-family:Arial,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module">import React from"react";import{createRoot}from"react-dom/client";import{AuthProvider}from"/src/context/AuthContext.jsx";import KeepsakesAdmin from"/src/pages/KeepsakesAdmin.jsx";import Config from"/src/components/KeepsakeStationConfigurator.jsx";function StationQA(){const[value,onChange]=React.useState({enabled:true,mode:'CELEBRATION',paid:{keychain:25,magnet:25},complimentary:{keychain:50,magnet:0},optional:{},stations:[{location:'Main Station',hours:4,feeCents:49900}]});return React.createElement(Config,{value,onChange,experiences:[{experience_id:'glam',key:'glam',name:'The Lola Glam',packages:[{package_id:'signature'}]}],packages:[{id:'signature',tier_key:'SIGNATURE'}]});}import GalleryKeepsakes from"/src/components/GalleryKeepsakes.jsx";createRoot(document.getElementById("root")).render(React.createElement(AuthProvider,null,${component}));</script></body></html>`));
      });
    }
  }], server: {host: '127.0.0.1', port: 0}});
  let browser;
  try {
    await vite.listen();
    const {chromium} = await import('playwright');
    browser = await chromium.launch();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    for (const width of [1440, 390]) {
      const page = await browser.newPage({viewport: {width, height: 1000}});
      page.setDefaultTimeout(10000);
      const errors = [], writes = [];
      page.on('pageerror', error => errors.push(error.message));
      const products = [{id: 'product-1', title: 'Photo Keychain', category: 'keychain', provider: 'IN_HOUSE', active: false, verified: false, retail_cents: 2499, tax_code: 'txcd_99999999', variants: [{id: 'white', label: 'White', sku: 'TEST-SKU', printArea: 'default', printSpec: {widthPx: 1200, heightPx: 800, dpi: 300, bleedPx: 10, safePx: 20}, specEvidence: {sourceUrl: 'https://www.prodigi.com/test-template', bleedPx: 10, safePx: 20, colorProfile: 'sRGB'}}]}];
      await page.route(url => url.pathname.startsWith('/api/'), async route => {
        const req = route.request(), pathname = new URL(req.url()).pathname;
        if(pathname.endsWith('/station-proposal/preview'))return route.fulfill({json:{...quoteCelebrationStation({...req.postDataJSON().configuration,selections:[{experience:'glam',tier:'SIGNATURE'}]},DEFAULT_STATION_POLICY),stations:[{location:'Main Station',hours:4,feeCents:49900}],commercialReady:false}});
        if(pathname.endsWith('/station-policy'))return route.fulfill({json:{policy:DEFAULT_STATION_POLICY,products:coreCatalogueView([]).filter(p=>p.stationEligible)}});
        if (req.method() !== 'GET') {writes.push({pathname, body: req.postDataJSON()}); return route.fulfill({json: pathname.endsWith('/test') ? {configured: true, mode: 'SANDBOX', status: 'CONNECTED'} : {ok: true}});}
        if (pathname.endsWith('/auth/me')) return route.fulfill({json: {user: {id: 'qa-admin', permissions: ['*']}}});
        if (pathname.endsWith('/discounts')) return route.fulfill({json:{discounts:[{id:'qa-discount',code:'OLD10',kind:'PERCENT',value:1000,minimum_cents:0,active:true}]}});
        if (pathname.endsWith('/catalogue')) return route.fulfill({json:{products:coreCatalogueView([])}});
        if (pathname.endsWith('/integrations/prodigi')) return route.fulfill({json: {configured: true, mode: 'SANDBOX', status: 'NOT_TESTED'}});
        if (pathname.endsWith('/albums/album-1')) return route.fulfill({json: {settings: {enabled: false, brandedMerchandise: false, originalSales: false, productIds: []}, products, sessions: [], media: [{id: 'media-1', filename: 'GuestComposite.jpg'}, {id: 'media-2', filename: 'GenuineOriginal.jpg'}]}});
        return route.fulfill({json: {metrics: {grossCents: 0, netCents: 0, orders: 0, averageCents: 0, productsSold: 0, supplierCents: 0, shippingCents: 0, stripeFeesCents: null, contributionCents: null, awaiting: 0, intervention: 0}, products, orders: [], byEvent: [], byProduct: [], readiness: {stripe: true, prodigi: false}}});
      });
      await page.goto(`${origin}/keepsakes-admin-qa`);
      await page.getByRole('heading', {name: 'Keepsakes & Orders', exact: true}).waitFor();
      await page.getByRole('button', {name: 'Products', exact: true}).click();
      await page.getByRole('heading',{name:'The 12-product Keepsakes catalogue'}).waitFor();
      await page.getByLabel('Photo Keychain retail price',{exact:true}).waitFor();
      assert.equal(await page.locator('.ka-product').count(),12);
      await page.waitForFunction(()=>document.querySelectorAll('.ka-product [data-preview-state="ready"]').length===12);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(await page.locator('.ka-product').evaluateAll(cards=>cards.every(card=>{const image=card.querySelector('.shop-own-preview').getBoundingClientRect(),copy=card.querySelector('.shop-own-preview+div').getBoundingClientRect(),form=card.querySelector('form').getBoundingClientRect();return image.right<=copy.left+1&&form.top>=Math.max(image.bottom,copy.bottom)-1;})),true,'Product image, copy and price form must not overlap');
      await page.screenshot({path:path.join(output,`products-${width}.png`),fullPage:true});
      const stationPage=await browser.newPage({viewport:{width,height:1000}});stationPage.on('pageerror',e=>console.error('STATION QA',e.message));
      await stationPage.route(url=>url.pathname.startsWith('/api/'),route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/auth/me'))return route.fulfill({json:{user:{id:'qa',permissions:['*']}}});if(path.endsWith('/station-policy'))return route.fulfill({json:{policy:DEFAULT_STATION_POLICY,products:coreCatalogueView([]).filter(p=>p.stationEligible)}});return route.fulfill({json:{...quoteCelebrationStation({selections:[{experience:'glam',tier:'SIGNATURE'}],complimentary:{keychain:50},paid:{keychain:25,magnet:25}},DEFAULT_STATION_POLICY),stations:[{location:'Main Station',hours:4,feeCents:49900}],commercialReady:false}});});
      await stationPage.goto(origin+'/keepsakes-admin-qa/station');await stationPage.waitForFunction(()=>document.querySelectorAll('.ka-product [data-preview-state="ready"]').length===6,{},{timeout:10000}).catch(async e=>{console.error(await stationPage.locator('body').innerText());throw e;});
      assert.equal(await stationPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(await stationPage.locator('.ka-product').evaluateAll(cards=>cards.every(card=>card.querySelector('.shop-own-preview').getBoundingClientRect().right<=card.querySelector('.shop-own-preview+div').getBoundingClientRect().left+1)),true);
      await stationPage.getByText(/Station enhancement:/).waitFor();assert.equal(await stationPage.locator('input[type=radio]').first().evaluate(el=>el.getBoundingClientRect().width),18);await stationPage.screenshot({path:path.join(output,`station-proposal-${width}.png`),fullPage:true});await stationPage.close();

      const card=page.locator('.ka-product').filter({has:page.getByRole('heading',{name:'Photo Keychain',exact:true})});
      await card.getByLabel('Photo Keychain retail price',{exact:true}).fill('24.99');
      await card.getByRole('button',{name:'Save price',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Photo Keychain price saved'}).waitFor();
      assert.equal(writes[0].body.retailCents,2499);
      assert.ok(writes[0].pathname.endsWith('/catalogue/keychain/price'));
      await page.getByRole('button',{name:'Discounts',exact:true}).click();await page.getByRole('heading',{name:'Guest discount codes',exact:true}).waitFor();await page.getByLabel('Discount code',{exact:true}).fill('GUEST10');await page.getByLabel('Percentage (%)',{exact:true}).fill('10');await page.getByRole('button',{name:'Create discount code',exact:true}).click();await page.getByRole('status').filter({hasText:'Discount code created'}).waitFor();const codeWrite=writes.find(r=>r.pathname.endsWith('/discounts'));assert.equal(codeWrite.body.code,'GUEST10');assert.equal(codeWrite.body.value,1000);await page.getByRole('button',{name:'Disable',exact:true}).click();await page.getByRole('status').filter({hasText:'Code disabled'}).waitFor();assert.deepEqual(writes.find(r=>r.pathname.endsWith('/discounts/qa-discount')).body,{active:false});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,`discounts-${width}.png`),fullPage:true});
      await page.getByRole('button',{name:'Integrations',exact:true}).click();
      await page.getByText('Standby · no automatic routing',{exact:true}).waitFor();
      assert.equal(writes.filter(row=>row.pathname.includes('/integrations/prodigi')).length,0);
      await page.goto(`${origin}/keepsakes-admin-qa/gallery`);
      await page.getByRole('heading', {name: 'The Lola Keepsakes', exact: true}).waitFor();
      await page.getByLabel('Enable The Lola Keepsakes', {exact: false}).check();
      await page.getByLabel('Allow branded-photo merchandise', {exact: false}).check();
      await page.getByLabel('Photo Keychain', {exact: false}).check();
      await page.getByRole('button', {name: 'Save settings', exact: true}).click();
      await page.getByRole('status').filter({hasText: 'Gallery commerce settings saved'}).waitFor();
      const settingsWrite = writes.find(row => row.pathname.endsWith('/albums/album-1'));
      assert.equal(settingsWrite.body.enabled, true);
      assert.equal(settingsWrite.body.originalSales, false);
      assert.deepEqual(settingsWrite.body.productIds, ['product-1']);
      assert.equal(settingsWrite.body.returnAddress, undefined);
      await page.getByRole('button', {name: 'Associate source photos', exact: true}).click();
      await page.getByLabel('Published guest photo / composite', {exact: false}).selectOption('media-1');
      await page.getByRole('button', {name: 'Add another source asset', exact: true}).click();
      const asset = page.getByRole('group', {name: 'Asset 2', exact: true});
      await asset.getByLabel('Existing image', {exact: false}).selectOption('media-2');
      await asset.getByLabel('Guest-facing label', {exact: true}).fill('Photo 1');
      await asset.getByLabel('Eligible for physical products', {exact: true}).check();
      await page.getByRole('button', {name: 'Save guest session mapping', exact: true}).click();
      await page.getByRole('status').filter({hasText: 'Genuine source assets associated'}).waitFor();
      const sessionWrite = writes.find(row => row.pathname.endsWith('/sessions'));
      assert.equal(sessionWrite.body.anchorMediaId, 'media-1');
      assert.equal(sessionWrite.body.assets.length, 2);
      assert.equal(sessionWrite.body.assets[0].mediaId, 'media-1');
      assert.equal(sessionWrite.body.assets[0].kind, 'COMPOSITE');
      assert.equal(sessionWrite.body.assets[1].mediaId, 'media-2');
      assert.equal(sessionWrite.body.assets[1].kind, 'ORIGINAL');
      assert.equal(sessionWrite.body.assets[1].merchandiseEligible, true);
      assert.equal(sessionWrite.body.assets[1].digitalEligible, false);
      assert.equal(sessionWrite.body.assets[1].included, true);
      await page.screenshot({path: path.join(output, `gallery-${width}.png`), fullPage: true});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {await browser?.close(); await vite.close();}
});
