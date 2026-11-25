import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('Keepsakes customizer preserves photo/crop/cart choices and requires an authoritative ready quote on desktop/mobile', { skip: process.env.KEEPSAKES_BROWSER_TEST !== 'true', timeout: 120000 }, async () => {
  const root = process.cwd(), output = path.join(os.tmpdir(), 'lola-keepsakes-browser');
  await fs.mkdir(output, { recursive: true });
  const vite = await createServer({ configFile: false, root, cacheDir: path.join(os.tmpdir(), 'lola-keepsakes-vite-cache'), plugins: [react(), {
    name: 'keepsakes-fixture', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/keepsakes-qa/')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import{BrowserRouter,Routes,Route}from"react-router-dom";import Keepsakes from"/src/pages/Keepsakes.jsx";createRoot(document.getElementById("root")).render(React.createElement(BrowserRouter,null,React.createElement(Routes,null,React.createElement(Route,{path:"/keepsakes-qa/:type/:token",element:React.createElement(Keepsakes)}),React.createElement(Route,{path:"/keepsakes-qa/order/:orderToken",element:React.createElement(Keepsakes)}))));</script></body></html>'));
      });
    },
  }], server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await vite.listen();
    const { chromium } = await import('playwright'); browser = await chromium.launch();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    for (const width of [1440, 768, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }); page.setDefaultTimeout(12000);
      const errors = [], quotes = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let photoCount = 4, enabled = true, checkoutReady = false;
      const products = [
        { id: 'mug', title: 'Photo Mug', category: 'MUG', provider: 'PRODIGI', retailCents: 2499, currency: 'USD', available: true, variants: [{ id: 'white', sku:'GLOBAL-MUG-W', label: 'White ceramic', color: '#f7f5ee', printSpec: { widthPx: 1000, heightPx: 416, customizationVerified: true } }, { id: 'black', sku:'GLOBAL-MUG-W', label: 'White ceramic · 11oz', color: '#f7f5ee', printSpec: { widthPx: 1000, heightPx: 416, customizationVerified: true } }] },
        { id: 'frame', title: 'Framed Print', category: 'FRAME', provider: 'PRODIGI', retailCents: 3999, currency: 'USD', available: true, variants: [{ id: 'oak', sku:'GLOBAL-CFP-12X16', attributes:{color:'black'}, label: 'Black frame', color: '#c39459', printSpec: { widthPx: 1200, heightPx: 900 } }] },
        { id: 'bundle', title: 'Digital Bundle', category: 'DIGITAL_BUNDLE', provider: 'DIGITAL', retailCents: 1299, currency: 'USD', available: true, variants: [{ id: 'original', label: 'Original files' }] },
        { id: 'postcard', title: 'Send a Postcard', category: 'POSTCARD', provider: 'LOB', retailCents: 599, currency: 'USD', available: true, variants: [{ id: '4x6', label: '4 × 6 inch',backTemplate:'lola-connect-v2' }] },
        { id: 'unverified', title: 'Unverified Keychain', available: false, variants: [] },
      ];
      const portrait = (n) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><defs><linearGradient id="a"><stop stop-color="#b8a689"/><stop offset="1" stop-color="#51483c"/></linearGradient></defs><rect width="1000" height="1000" fill="url(#a)"/><circle cx="500" cy="375" r="170" fill="#d4a67d"/><path d="M200 1000Q180 560 500 560Q820 560 800 1000" fill="#242b31"/><text x="500" y="950" fill="#e9c58b" font-family="Georgia" font-size="56" text-anchor="middle">Synthetic Photo ${n}</text></svg>`)}`;
      // Match the deployed API: CORP denies no-cors image embedding, while
      // anonymous CORS requests from the gallery are explicitly permitted.
      await page.route('http://keepsakes-assets.test/**', async route => route.fulfill({
        contentType: 'image/svg+xml',
        headers: {'Cross-Origin-Resource-Policy': 'same-origin', 'Access-Control-Allow-Origin': origin},
        body: decodeURIComponent(portrait(Number(/photo-(\d+)/.exec(route.request().url())?.[1])||1).split(',').slice(1).join(',')),
      }));
      await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
        const request = route.request(), pathname = new URL(request.url()).pathname;
        if (pathname.endsWith('/postcard-preview')) return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64')});
        if (pathname.endsWith('/quote')) { const body = request.postDataJSON(); quotes.push(body); const physical = body.items.some(item => item.productId !== 'bundle'); return route.fulfill({ json: { quoteId: `synthetic-quote-${quotes.length}`, subtotalCents: 6498, shippingCents: 899, taxCents: 0, totalCents: 7397, currency: 'USD', expiresAt: new Date(Date.now() + 600000).toISOString(), checkoutReady, issues: checkoutReady ? [] : ['Sandbox provider setup is incomplete. No payment will be taken.'], proofs: physical ? [{label: 'Photo Mug', side: 'front', itemIndex: 0, recipientIndex: null, url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII='}, {label: 'Postcard message layout', side: 'back', itemIndex: 1, recipientIndex: 0, url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII='}] : [] } }); }
        if (pathname.includes('/orders/')) return route.fulfill({ json: { order: { id: 'synthetic-order', status: 'PAID', mode:'TEST', paidAt:'2035-10-15T12:00:00Z', createdAt:'2035-10-15T12:00:00Z',totalCents:2499,currency:'USD',fulfillments:[{provider:'PRODIGI',status:'SUBMITTED'}],items: [{ id: 'item-1', title: 'Photo Mug',provider:'PRODIGI', quantity: 1, status: 'IN_PRODUCTION' }] }, fulfillments:[{provider:'PRODIGI',status:'SUBMITTED'}], downloads: [] } });
        return route.fulfill({ json: { album: { id: 'synthetic-gallery', title: 'MINIO Brand Activation · Synthetic QA' }, enabled, assets: Array.from({ length: photoCount }, (_, index) => ({ id: `photo-${index + 1}`, label: `Photo ${index + 1}`, kind: index ? 'ORIGINAL' : 'COMPOSITE', width: 2000, height: 2000, url: `http://keepsakes-assets.test/photo-${index + 1}.svg`, digitalEligible: index !== 0, merchandiseEligible: true, included: index === 0 })), products, readiness: { checkout: checkoutReady, message: 'Sandbox checkout is not enabled.' } } });
      });
      await page.goto(`${origin}/keepsakes-qa/photo/synthetic-token`);
      await page.getByRole('heading', {name:'Shop personalized keepsakes',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Add to cart',exact:true}).count(),0,'Collection comes before customization');
      await page.locator('.ks-product-card .kp-preview[data-preview-state="ready"]').first().waitFor();
      await page.screenshot({path:path.join(output,`collection-${width}.png`),fullPage:true});
      await page.getByRole('button',{name:'View options for Photo Mug',exact:true}).click();
      const mugCanvas=page.locator('.ks-preview-panel .kp-preview[data-preview-state="ready"] canvas');
      await mugCanvas.waitFor();
      assert.equal(await mugCanvas.evaluate(canvas=>canvas.width===1000&&canvas.height===750),true);
      const firstPreview=await mugCanvas.evaluate(canvas=>canvas.toDataURL());
      assert.equal(await page.getByText('Unverified Keychain').count(), 0);
      await page.screenshot({ path: path.join(output, `mug-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Select Photo 2', exact: true }).click();
      await page.waitForFunction(first=>document.querySelector('.ks-preview-panel canvas')?.toDataURL()!==first,firstPreview);
      assert.notEqual(await mugCanvas.evaluate(canvas=>canvas.toDataURL()),firstPreview,'Changing the photo must change actual product pixels');
      await page.getByRole('button', { name: 'White ceramic · 11oz', exact: true }).click();
      await page.getByText('Adjust your photo', { exact: true }).click();
      await page.getByLabel('Photo layout', { exact: true }).selectOption('cover');
      await page.getByLabel('Zoom', { exact: false }).fill('1.5');
      await page.getByRole('button', { name: 'Increase quantity', exact: true }).click();
      await page.getByRole('button',{name:'Back to Keepsakes',exact:true}).click();
      await page.getByRole('button',{name:'View options for Photo Mug',exact:true}).click();
      await page.getByText('Adjust your photo',{exact:true}).click();
      assert.equal(await page.getByLabel('Zoom',{exact:false}).inputValue(),'1.5','Back from collection preserves customization');
      await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Photo Mug added' }).waitFor();
      await page.getByRole('button', { name: 'View options for Framed Print',exact:true }).click();
      await page.getByRole('button', { name: 'Select Photo 4', exact: true }).click();
      await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
      await page.getByRole('button', { name: 'Cart (3)', exact: true }).click();
      await page.getByRole('button',{name:'Proceed to checkout',exact:true}).click();
      const dialog = page.getByRole('dialog', { name: 'Your keepsakes cart' });
      await dialog.getByRole('button', { name: 'Edit item 1', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Select Photo 2', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByRole('button', { name: 'White ceramic · 11oz', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByLabel('Zoom', { exact: false }).inputValue(), '1.5');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await page.getByRole('button', { name: 'Cart (3)', exact: true }).click();
      await page.getByRole('button',{name:'Proceed to checkout',exact:true}).click();
      await dialog.getByLabel('Email for your order updates', { exact: true }).fill('synthetic@example.invalid');
      for (const [label, value] of [['Full name', 'Synthetic Guest'], ['Street address', '12 Test Street'], ['City', 'Test City'], ['State / province', 'MA'], ['ZIP / postal code', '02134']]) await dialog.getByLabel(label, { exact: true }).fill(value);
      await dialog.getByRole('button', { name: 'Calculate shipping & tax', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Your order total', exact: true }).waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Continue to secure checkout', exact: true }).isDisabled(), true);
      await dialog.getByRole('heading', { name: 'Review print layouts', exact: true }).waitFor();
      assert.equal(await dialog.locator('.ks-print-layout-grid img[loading=lazy]').count(), 2);
      assert.match(await dialog.locator('.ks-print-layout-review').innerText(), /printer adds the recipient address and postage/i);
      const review = dialog.getByRole('checkbox', { name: 'I reviewed these print layouts and recipient details', exact: true });
      assert.equal(await review.isChecked(), false);
      await review.check();
      assert.equal(await dialog.getByRole('button', { name: 'Continue to secure checkout', exact: true }).isDisabled(), true);
      assert.equal(quotes.length, 1); assert.equal(quotes[0].items.length, 2); assert.equal(quotes[0].items[0].customization.zoom, 1.5); assert.equal(quotes[0].items[0].customization.x, .5); assert.equal(quotes[0].items[0].customization.y, .5); assert.equal(quotes[0].items[0].quantity, 2); assert.deepEqual(quotes[0].items[0].assetIds, ['photo-2']); assert.equal(quotes[0].shippingAddress.zip, '02134');
      // Becoming ready never bypasses review of a newly generated quote.
      checkoutReady = true;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await dialog.getByText('Sandbox checkout is not enabled.', { exact: true }).waitFor({state: 'detached'});
      await dialog.getByRole('button', { name: 'Calculate shipping & tax', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Review print layouts', exact: true }).waitFor();
      assert.equal(await review.isChecked(), false);
      assert.equal(await dialog.getByRole('button', { name: 'Continue to secure checkout', exact: true }).isDisabled(), true);
      await review.check();
      assert.equal(await dialog.getByRole('button', { name: 'Continue to secure checkout', exact: true }).isDisabled(), false);
      // No payment navigation is invoked by this synthetic test.
      await dialog.getByLabel('Email for your order updates', { exact: true }).fill('changed@example.invalid');
      assert.equal(await review.count(), 0);
      await dialog.getByRole('button', { name: 'Calculate shipping & tax', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Review print layouts', exact: true }).waitFor();
      assert.equal(await review.isChecked(), false);
      await page.screenshot({ path: path.join(output, `cart-${width}.png`), fullPage: true });
      await dialog.getByRole('button', { name: 'Close cart', exact: true }).click();
      await page.screenshot({ path: path.join(output, `shop-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'View options for Digital Bundle',exact:true }).click();
      assert.equal(await page.getByRole('button', { name: 'Select Photo 1', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Select Photo 3', exact: true }).click();
      await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
      await page.getByRole('button', { name: 'Cart (4)', exact: true }).click();
      await page.getByRole('button',{name:'Proceed to checkout',exact:true}).click();
      assert.match(await dialog.innerText(), /2 photos/);
      await dialog.getByRole('button', { name: 'Remove item 3', exact: true }).click();
      assert.doesNotMatch(await dialog.innerText(), /Digital Bundle/);
      await dialog.getByRole('button', { name: 'Close cart', exact: true }).click();
      await page.getByRole('button', { name: 'View options for Send a Postcard',exact:true }).click();
      await page.getByLabel('How many postcards?',{exact:true}).fill('4');
      await page.getByLabel('Use the same note for every recipient',{exact:true}).uncheck();
      await page.getByLabel('Back artwork color',{exact:true}).fill('#703040');
      await page.getByRole('button',{name:'Continue to recipients',exact:true}).click();
      const sender=page.getByRole('group',{name:'Your return address',exact:true});
      for(const [label,value] of [['Full name','Synthetic Sender'],['Street address','1 Sender Street'],['City','Boston'],['State / province','MA'],['ZIP / postal code','02134']])await sender.getByLabel(label,{exact:true}).fill(value);
      for (const index of [1, 2, 3, 4]) {
        const recipient = page.getByRole('group', { name: `Recipient ${index}`, exact: true });
        for (const [label, value] of [['Full name', `Synthetic Recipient ${index}`], ['Street address', `${index} Test Street`], ['City', 'Test City'], ['State / province', 'MA'], ['ZIP / postal code', '02134']]) await recipient.getByLabel(label, { exact: true }).fill(value);
        await recipient.getByLabel('Your message (optional)', { exact: true }).fill(`A personal message for recipient ${index}.`);
        await recipient.getByLabel('Message font', {exact:true}).selectOption(index===1?'serif':'handwritten');
        await recipient.getByLabel('Font color', {exact:true}).selectOption(index===1?'#17365d':'#703040');
        assert.equal(await recipient.getByLabel('Message font', {exact:true}).locator('option').count(),5);
        assert.equal(await recipient.locator('textarea').inputValue(),`A personal message for recipient ${index}.`);
      }
      await page.getByRole('button',{name:'Review postcards',exact:true}).click();
      await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
      await page.getByRole('button', { name: 'Cart (7)', exact: true }).click();
      await page.getByRole('button',{name:'Proceed to checkout',exact:true}).click();
      assert.match(await dialog.innerText(), /4 recipients/);
      await dialog.getByRole('button', { name: 'Calculate shipping & tax', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Your order total', exact: true }).waitFor();
      assert.equal(quotes[3].items[2].returnAddress.name,'Synthetic Sender');assert.equal(quotes[3].items[2].returnAddress.zip,'02134');assert.equal(quotes[3].items[2].recipients.length, 4);assert.equal(quotes[3].items[2].quantity,1);assert.equal(quotes[3].items[2].postcardArtworkColor,'#703040');
      assert.equal(quotes[3].items[2].recipients[1].message, 'A personal message for recipient 2.');
      assert.equal(quotes[3].items[2].recipients[0].messageFont,'serif');
      assert.equal(quotes[3].items[2].recipients[1].messageFont,'handwritten');
      assert.equal(quotes[3].items[2].recipients[1].messageColor,'#703040');
      // A checkout return restores the cart and recipient drafts but never an
      // old quote or proof approval. Totals must be recalculated server-side.
      await page.reload();
      await page.getByRole('button',{name:'Cart (7)',exact:true}).click();
      assert.equal(await dialog.getByRole('heading',{name:'Your order total',exact:true}).count(),0);
      await dialog.getByText('Review 4 recipients and notes',{exact:true}).click();
      assert.match(await dialog.innerText(),/A personal message for recipient 4/);
      await dialog.getByRole('button',{name:'Proceed to checkout',exact:true}).click();
      assert.equal(await dialog.getByLabel('ZIP / postal code',{exact:true}).inputValue(),'02134');
      // Digital-only purchases do not require a physical print-layout review.
      for (let line = 0; line < 3; line++) await dialog.getByRole('button', {name: 'Remove item 1', exact: true}).click();
      await dialog.getByRole('button', { name: 'Close cart', exact: true }).click();
      await page.getByRole('button', { name: 'View options for Digital Bundle',exact:true }).click();
      await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
      await page.getByRole('button', { name: 'Cart (1)', exact: true }).click();
      await page.getByRole('button',{name:'Proceed to checkout',exact:true}).click();
      await dialog.getByRole('button', { name: 'Calculate shipping & tax', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Your order total', exact: true }).waitFor();
      assert.equal(await dialog.getByRole('checkbox', {name: 'I reviewed these print layouts and recipient details', exact: true}).count(), 0);
      assert.equal(await dialog.getByRole('button', { name: 'Continue to secure checkout', exact: true }).isDisabled(), false);
      await dialog.getByRole('button', { name: 'Close cart', exact: true }).click();
      // Arbitrary session lengths render actual assets only, without assuming four.
      for (const count of [1, 2, 3, 6]) { photoCount = count; await page.goto(`${origin}/keepsakes-qa/photo/synthetic-token?product=mug`); await page.getByRole('heading', { name: 'Photo Mug', exact: true,level:2 }).waitFor(); assert.equal(await page.getByRole('button', { name: /^Select Photo \d+$/ }).count(), count); }
      enabled = false; await page.reload(); await page.getByRole('heading', { name: 'Enjoy your photos', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Add to cart', exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); assert.deepEqual(errors, []);
      await page.goto(`${origin}/keepsakes-qa/order/private-synthetic-order`); await page.getByRole('heading', { name: 'Photo Mug', exact: true,level:3 }).waitFor(); assert.match(await page.locator('body').innerText(), /in production/i);assert.equal(await page.locator('.ks-timeline li.complete').count(),3);await page.screenshot({path:path.join(output,`order-${width}.png`),fullPage:true});
      await page.close();
    }
  } finally { await browser?.close(); await vite.close(); }
});
