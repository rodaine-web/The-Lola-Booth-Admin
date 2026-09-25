import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import jsQR from 'jsqr';

// Decode the QR from the rendered PDF, not from the input supplied to its encoder.
export async function verifyInvoiceQr(bytes, expectedUrl) {
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const destinations = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(pixels.data, pixels.width, pixels.height);
      if (qr) destinations.push(qr.data);
    }
    assert.ok(destinations.includes(expectedUrl), 'Generated PDF QR must decode to its invoice-specific LOLA payment URL');
    assert.ok(destinations.every(url => !url.includes('stripe.com')), 'QR must stay on LOLA');
  } finally { await loadingTask.destroy(); }
  return { decoded: true, invoiceSpecific: true, providerNeutral: true };
}
