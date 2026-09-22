import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { generateProposalPdf, generateInvoicePdf } from '../server/src/services/document-service.js';

async function readPdf(buffer) {
  const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0 });
  const pdf = await loading.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    pages.push({ text: items.map(item => item.str).join(' '), items });
  }
  await loading.destroy();
  return pages;
}
const proposal = { proposal_number: 'QA-PROP', client_name: 'QA Client', event_name: 'QA Event', event_date: '2026-11-21', venue_name: 'QA Venue', package_name: 'QA Package' };

test('proposal PDFs retain every custom section, late bullet, and long paragraph across pages', async () => {
  const sections = Array.from({ length: 12 }, (_, index) => ({
    title: `Section ${index + 1}`,
    body: index === 5 ? `${'Extended terms and event requirements. '.repeat(240)}END_LONG_TERMS` : `BODY_MARKER_${index}`,
    items: [`BULLET_MARKER_${index}`]
  }));
  const pages = await readPdf(await generateProposalPdf({ ...proposal, editable_sections: sections }));
  const text = pages.map(p => p.text).join(' ');
  assert.ok(pages.length > 2);
  for (let i = 0; i < 12; i++) {
    assert.ok(text.includes(`BULLET_MARKER_${i}`), `missing bullet ${i}`);
    if (i !== 5) assert.ok(text.includes(`BODY_MARKER_${i}`), `missing body ${i}`);
  }
  assert.ok(text.includes('END_LONG_TERMS'));
  for (const page of pages.slice(1)) {
    const body = page.items.filter(item => /MARKER|Extended terms|END_LONG/.test(item.str));
    assert.ok(body.every(item => item.transform[5] >= 118), 'body entered footer region');
  }
});

test('short proposal summaries retain bullet-only sections in the last three columns', async () => {
  const sections = Array.from({ length: 7 }, (_, i) => ({title: `Part ${i}`, items: [`ONLY_BULLET_${i}`]}));
  const pages = await readPdf(await generateProposalPdf({ ...proposal, editable_sections: sections }));
  const text = pages.map(p => p.text).join(' ');
  for (let i = 0; i < 7; i++) assert.ok(text.includes(`ONLY_BULLET_${i}`));
});

test('long invoices paginate every row and retain payment terms, adjustments and zero balance', async () => {
  const pages = await readPdf(await generateInvoicePdf({
    invoice_number: 'QA-INV', client_name: 'QA Client', secure_token: 'qa-token',
    subtotal: 1200, discount: 100, tax: 50, total: 1150, amount_paid: 1150,
    amount_outstanding: 0, balance_due: 1150,
    terms: `${'The venue must provide safe access and power. '.repeat(100)}END_INVOICE_TERMS`,
    items: Array.from({ length: 35 }, (_, i) => ({ label: `INVOICE_ROW_${i}`, detail: `DETAIL_ROW_${i}`, quantity: 1, unit_price: 10, line_total: 10 }))
  }));
  const text = pages.map(p => p.text).join(' ');
  for (let i = 0; i < 35; i++) {
    assert.ok(text.includes(`INVOICE_ROW_${i}`));
    assert.ok(text.includes(`DETAIL_ROW_${i}`));
  }
  assert.ok(text.includes('END_INVOICE_TERMS'));
  assert.match(text, /DISCOUNT.*\$100\.00/);
  assert.match(text, /TAX.*\$50\.00/);
  assert.match(text, /BALANCE DUE.*\$0\.00/);
  for (const page of pages) {
    assert.ok(page.items.filter(item => /INVOICE_ROW|DETAIL_ROW/.test(item.str)).every(item => item.transform[5] >= 118), 'invoice row entered footer region');
  }
});

test('invoice QR decodes from the actual PDF rendering to the stable invoice URL', async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const { default: jsQR } = await import('jsqr');
  const { env } = await import('../server/src/config/env.js');
  const buffer = await generateInvoicePdf({ invoice_number: 'QA-QR', client_name: 'QA Client', secure_token: 'qa-qr-token', items: [], total: 100, amount_outstanding: 100 });
  const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0 });
  const pdf = await loading.promise;
  const page = await pdf.getPage(pdf.numPages);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const decoded = jsQR(pixels.data, canvas.width, canvas.height);
  assert.equal(decoded?.data, `${env.publicBaseUrl.replace(/\/$/, '')}/invoice/qa-qr-token`);
  await loading.destroy();
});
