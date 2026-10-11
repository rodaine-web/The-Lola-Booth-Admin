import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { generateProposalPdf, generateInvoicePdf, proposalHtml } from '../server/src/services/document-service.js';

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

test('proposal journey explains signing and workspace while preserving zero minimum and accepted terms', async () => {
  const saved = { ...proposal, proposal_type: 'CORPORATE', total: 599, pricing_snapshot: { total: 599, amount_due_now: 0, deposit_amount: 179.70 }, content: { terms: 'IMMUTABLE_ACCEPTED_TERMS' } };
  const before = structuredClone(saved);
  const html = proposalHtml(saved);
  assert.match(html, /Booking Retainer Fee/);
  assert.match(html, /class="amt">\$0\.00/);
  assert.match(html, /Sign Agreement/);
  assert.match(html, /Open The Client Workspace/);
  assert.match(html, /written confirmation/);
  assert.match(html, /IMMUTABLE_ACCEPTED_TERMS/);
  const pages = await readPdf(await generateProposalPdf(saved));
  const text = pages.map(page => page.text).join(' ');
  assert.match(text, /Booking retainer fee: \$0\.00/);
  assert.match(text, /Sign your agreement/);
  assert.match(text, /Open The Client Workspace/);
  assert.match(text, /IMMUTABLE_ACCEPTED_TERMS/);
  assert.deepEqual(saved, before);
});

test('proposal PDFs retain every custom section, late bullet, and long paragraph across pages', async () => {
  const sections = Array.from({ length: 12 }, (_, index) => ({
    title: `Section ${index + 1}`,
    body: index === 5 ? `${'Extended terms and event requirements. '.repeat(240)}END_LONG_TERMS` : `BODY_MARKER_${index}`,
    items: [`BULLET_MARKER_${index}`]
  }));
  const pages = await readPdf(await generateProposalPdf({ ...proposal, editable_sections: sections }));
  const text = pages.map(p => p.text).join(' ');
  assert.ok(pages.length >= 6);
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
  assert.equal(decoded?.data, `${env.publicBaseUrl.replace(/\/$/, '')}/pay/qa-qr-token`);
  await loading.destroy();
});

test('settled and void invoice PDFs preserve terms without offering another payment', async () => {
  for (const state of [{ status: 'PAID', amount_outstanding: 0, balance_due: 100 }, { status: 'VOID', amount_outstanding: 100 }]) {
    const saved = { ...state, invoice_number: 'QA-SETTLED', secure_token: 'settled-token', items: [], total: 100, amount_paid: 100, terms: 'SAVED_COMMERCIAL_TERMS' };
    const before = structuredClone(saved);
    const loading = getDocument({ data: new Uint8Array(await generateInvoicePdf(saved)), useSystemFonts: true, verbosity: 0 });
    const pdf = await loading.promise;
    let text = '';
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      text += (await page.getTextContent()).items.map(item => item.str).join(' ');
      assert.equal((await page.getAnnotations()).filter(item => item.url?.includes('/pay/')).length, 0);
    }
    assert.match(text, /NO PAYMENT DUE/);
    assert.match(text, /SAVED_COMMERCIAL_TERMS/);
    assert.doesNotMatch(text, /P\s*A\s*Y\s+O\s*N\s*L\s*I\s*N\s*E|S\s*C\s*A\s*N\s+TO\s+PAY/);
    assert.deepEqual(saved, before);
    await loading.destroy();
  }
});

test('outstanding invoices explain the booking retainer fee and all confirmation prerequisites', async () => {
  const pages = await readPdf(await generateInvoicePdf({invoice_number:'QA-DUE',items:[],total:100,amount_outstanding:100,due_date:'2026-11-01',secure_token:'due-token'}));
  const text = pages.map(page => page.text).join(' ');
  assert.match(text, /booking retainer fee/);
  assert.match(text, /signed agreement and written confirmation/);
  assert.match(text, /2026-11-01/);
  assert.match(text, /P\s*A\s*Y\s+O\s*N\s*L\s*I\s*N\s*E/);
});

test('proposal pricing and terms paginate with continuous footers and preserve zero deposit', async () => {
  const pages = await readPdf(await generateProposalPdf({
    ...proposal, proposal_type: 'CORPORATE', guest_count: 80, start_time: '18:00', end_time: '21:00',
    selected_experiences: [{ name: 'Lola Glam', package_name: 'The Signature' }],
    pricing_snapshot: {total: 899, deposit_amount: 0},
    line_items_snapshot: Array.from({length: 40}, (_, i) => ({description: `SCOPE_ROW_${i} ${'Detailed event service '.repeat(5)}`, line_total: 20})),
    content: {terms: `${'Saved booking terms and venue requirements. '.repeat(220)}END_SAVED_TERMS`}
  }));
  const all = pages.map(p => p.text).join(' ');
  for(let i=0;i<40;i++) assert.ok(all.includes(`SCOPE_ROW_${i}`));
  assert.ok(all.includes('END_SAVED_TERMS'));
  assert.match(all, /Booking retainer fee: \$0\.00/);
  assert.match(all, /November 21, 2026/);
  assert.match(all, /6:00 PM - 9:00 PM/);
  for(const [index,page] of pages.entries()) {
    assert.match(page.text,/info@thelolabooth.com/);
    assert.ok(page.items.some(item=>item.str===String(index+1)&&item.transform[4]>=548&&item.transform[5]<70),'missing page number');
    const body=page.items.filter(item=>/SCOPE_ROW|Saved booking|END_SAVED/.test(item.str));
    assert.ok(body.every(item=>item.transform[5]>=118),'proposal content entered footer');
  }
});

test('client narrative is complete in PDF and HTML without disclosing internal notes', async () => {
  const { proposalHtml } = await import('../server/src/services/document-service.js');
  const record = {
    ...proposal, proposal_type: 'CORPORATE', notes: 'PRIVATE_ADMIN_MARKER',
    content: {introduction: 'FALLBACK_INTRO_MARKER', notes: 'PRIVATE_CONTENT_MARKER', terms: 'SAVED_TERMS_MARKER', closing: 'SIGNED_LOLA_MARKER'},
    editable_sections: [
      {title: 'Introduction', body: 'CUSTOM_INTRO_MARKER'},
      {title: 'About the Event', body: 'CUSTOM_EVENT_MARKER'},
      {title: 'Client Notes', body: `${'Client-facing planning detail. '.repeat(300)}END_CLIENT_NOTES_MARKER`, items: ['CLIENT_BULLET_MARKER']},
      {title: 'Conclusion', body: 'CUSTOM_CONCLUSION_MARKER'}
    ]
  };
  const pages = await readPdf(await generateProposalPdf(record));
  const pdfText = pages.map(p=>p.text).join(' ');
  const html = proposalHtml(record);
  for(const text of [pdfText,html]){
    for(const marker of ['CUSTOM_INTRO_MARKER','CUSTOM_EVENT_MARKER','END_CLIENT_NOTES_MARKER','CLIENT_BULLET_MARKER','CUSTOM_CONCLUSION_MARKER','SIGNED_LOLA_MARKER'])assert.ok(text.includes(marker),`missing ${marker}`);
    assert.doesNotMatch(text,/PRIVATE_ADMIN_MARKER|PRIVATE_CONTENT_MARKER|FALLBACK_INTRO_MARKER/);
  }
  for(const page of pages){
    assert.ok(page.items.filter(item=>/Client-facing|END_CLIENT_NOTES/.test(item.str)).every(item=>item.transform[5]>=118),'notes entered footer');
  }
});
