import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';

test('opt-in gallery lightbox shows only verified eligible products and preserves free access through commerce failure and revocation', {skip: process.env.KEEPSAKES_BROWSER_TEST !== 'true', timeout: 120000}, async () => {
  const output = path.join(os.tmpdir(), 'lola-keepsakes-gallery-browser');
  await fs.mkdir(output, {recursive: true});
  const vite = await createServer({configFile: false, root: process.cwd(), cacheDir: path.join(os.tmpdir(), 'lola-keepsakes-gallery-vite-cache'), plugins: [react(), {
    name: 'keepsakes-gallery-fixture', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/gallery-qa/')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module">import React from"react";import{createRoot}from"react-dom/client";import{BrowserRouter,Routes,Route}from"react-router-dom";import"/src/styles/experience.css";import PublicGallery from"/src/pages/PublicGallery.jsx";createRoot(document.getElementById("root")).render(React.createElement(BrowserRouter,null,React.createElement(Routes,null,React.createElement(Route,{path:"/gallery-qa/:type/:token",element:React.createElement(PublicGallery)}))));</script></body></html>'));
      });
    }
  }], define: {'import.meta.env.VITE_APP_ENV': JSON.stringify('test')}, server: {host: '127.0.0.1', port: 0}});
  let browser;
  try {
    await vite.listen();
    const {chromium} = await import('playwright'); browser = await chromium.launch();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#e8ded2"/><rect x="40" y="40" width="1120" height="720" fill="#b58d6c"/><circle cx="700" cy="330" r="150" fill="#d5af91"/><path d="M430 760Q450 480 700 480Q950 480 970 760" fill="#303d43"/><text x="75" y="150" fill="#fff" font-family="Georgia" font-size="64">Synthetic event photo</text></svg>';
    for (const width of [1440, 768, 390]) {
      const context = await browser.newContext({viewport: {width, height: 1000}, permissions: ['clipboard-read', 'clipboard-write']});
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = [], downloads = [];
      let enabled = true, supplierFailure = false, revoked = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      await page.route(url => url.pathname.startsWith('/api/'), async route => {
        const req = route.request(), pathname = new URL(req.url()).pathname;
        if (pathname.startsWith('/api/keepsakes/')) return supplierFailure ? route.fulfill({status: 503, json: {error: {message: 'Commerce temporarily unavailable'}}}) : route.fulfill({json: {enabled, assets: [{id: 'asset-1', mediaId: 'photo-1', merchandiseEligible: true, digitalEligible: false, included: true}], products: [
          ...['postcard', 'print', 'frame', 'mug', 'magnet', 'keychain'].map(category => ({id: category, title: ({postcard: 'Send a Postcard', print: 'Order Prints', frame: 'Frame My Photo', mug: 'Photo Mug', magnet: 'Photo Magnet', keychain: 'Create a Keychain'})[category], category, provider: category === 'postcard' ? 'LOB' : 'PRODIGI', variants:[{id:'default',sku:({mug:'GLOBAL-MUG-W',frame:'GLOBAL-CFP-12X16',print:'GLOBAL-PHO-4X6'})[category],...(category==='postcard'?{backTemplate:'lola-connect-v2'}:{})}], available: category !== 'keychain', verified: category !== 'keychain'})),
          {id: 'digital', title: 'Original Digital Photo', category: 'digital', provider: 'DIGITAL', available: true}
        ]}});
        if (pathname.endsWith('/download')) {downloads.push(req.postDataJSON()); return route.fulfill({json: {url: '/api/gallery/test-download'}});}
        if (pathname.endsWith('/test-download')) return route.fulfill({contentType: 'image/svg+xml', headers: {'Content-Disposition': 'attachment; filename="synthetic-photo.svg"'}, body: image});
        if (pathname.endsWith('/preview')) return route.fulfill({contentType: 'image/svg+xml', body: image});
        if (revoked) return route.fulfill({status: 404, json: {error: {message: 'This gallery access has expired.'}}});
        return route.fulfill({json: {title: 'Synthetic Brand Activation', eventName: 'Synthetic QA', eventDate: '2035-10-15', type: 'PERSON', allowDownload: true, allowZip: true, media: [{id: 'photo-1', mediaType: 'IMAGE', filename: 'synthetic-composite.jpeg', url: '/api/gallery/preview'}]}});
      });
      const url = `${origin}/gallery-qa/photo/${'a'.repeat(43)}`;
      await page.goto(url);
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('heading', {name: 'The Lola Keepsakes', exact: true}).waitFor();
      assert.equal(await dialog.getByRole('link', {name: /^Customize /}).count(), 4);
      assert.equal(await dialog.getByText('Create a Keychain', {exact: true}).count(), 0);
      assert.equal(await dialog.getByText('Original Digital Photo', {exact: true}).count(), 0);
      assert.match(await dialog.getByRole('link', {name: 'Customize Photo Mug', exact: true}).getAttribute('href'), /product=mug&asset=photo-1/);
      await page.screenshot({path:path.join(output,`gallery-before-${width}.png`),fullPage:true});
      await dialog.getByRole('button', {name: 'Favorite this photo', exact: true}).click();
      assert.equal(await dialog.getByRole('button', {name: 'Favorite this photo', exact: true}).getAttribute('aria-pressed'), 'true');
      await dialog.getByRole('button', {name: 'Copy Photo Link', exact: true}).click();
      await dialog.getByRole('status').filter({hasText: 'Photo link copied.'}).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', {name: 'Download this photo', exact: true}).click(); await download;
      assert.equal(downloads.length, 1);
      await page.screenshot({path: path.join(output, `gallery-${width}.png`), fullPage: true});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      // A disabled/failing commerce endpoint falls back to the unchanged viewer.
      enabled = false; await page.reload();
      await dialog.getByRole('button', {name: 'Copy Photo Link', exact: true}).waitFor();
      assert.equal(await dialog.getByRole('heading', {name: 'The Lola Keepsakes', exact: true}).count(), 0);
      assert.equal(await dialog.getByRole('button', {name: 'Download', exact: true}).count(), 1);
      supplierFailure = true; await page.reload();
      await dialog.getByRole('button', {name: 'Favorite this photo', exact: true}).waitFor();
      assert.equal(await dialog.getByRole('heading', {name: 'The Lola Keepsakes', exact: true}).count(), 0);
      // Existing periodic gallery authorization still closes every photo on revocation.
      revoked = true; await page.clock.fastForward(46000);
      await page.getByRole('alert').filter({hasText: 'This gallery access has expired.'}).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {await browser?.close(); await vite.close();}
});
