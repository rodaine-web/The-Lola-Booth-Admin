import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import sanitizeHtml from "sanitize-html";
import { getStorageProvider } from "./storage-service.js";

const money = (value) => `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandRoot = path.resolve(__dirname, "../../../public/brand");
const brandAssets = {
  primaryDark: path.join(brandRoot, "LOLA_Primary_Dark_Transparent.png"),
  horizontalDark: path.join(brandRoot, "LOLA_Horizontal_Dark_Transparent.png"),
  monogramGold: path.join(brandRoot, "LOLA_LB_Monogram_Gold.png")
};
const brand = {
  ivory: "#FAF7F1",
  champagne: "#D9C6A8",
  gold: "#B89B6B",
  charcoal: "#1A1A1A",
  taupe: "#E8DDD0",
  muted: "#6f665c",
  white: "#FFFFFF"
};

function logoBuffer(asset = "primaryDark") {
  const selected = brandAssets[asset] || brandAssets.primaryDark;
  return fs.existsSync(selected) ? fs.readFileSync(selected) : null;
}

function logoPath(asset = "primaryDark") {
  const selected = brandAssets[asset] || brandAssets.primaryDark;
  return fs.existsSync(selected) ? selected : null;
}

function logoDataUri(asset = "primaryDark") {
  const logo = logoBuffer(asset);
  return logo ? `data:image/png;base64,${logo.toString("base64")}` : "";
}

export function sanitizeContent(value) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: ["p", "strong", "em", "ul", "ol", "li", "a", "br"],
    allowedAttributes: { a: ["href"] }
  });
}

export function proposalHtml(proposal) {
  const content = proposal.content || {};
  const pricing = proposal.pricing_snapshot || {};
  const primaryLogo = logoDataUri("primaryDark");
  const horizontalLogo = logoDataUri("horizontalDark");
  const lineItems = proposal.line_items_snapshot || [];
  const eventRows = [
    ["Client", proposal.client_name],
    ["Event", proposal.event_name || proposal.event_type],
    ["Date", proposal.event_date],
    ["Time", [proposal.start_time, proposal.end_time].filter(Boolean).join(" - ")],
    ["Venue", proposal.venue_name],
    ["Location", proposal.venue_address || proposal.location],
    ["Guests", proposal.guest_count]
  ].filter(([, value]) => value);
  return `<!doctype html>
  <html><head><meta charset="utf-8"><title>${proposal.proposal_number}</title>
  <style>
  body{font-family:Montserrat,"Avenir Next","Helvetica Neue",Arial,sans-serif;color:${brand.charcoal};background:${brand.ivory};margin:0;line-height:1.55}
  main{background:${brand.white};margin:0 auto;max-width:940px;min-height:100vh}
  section{padding:34px 50px}.cover{min-height:620px;background:${brand.ivory};display:grid;align-content:center;text-align:center}
  h1,h2,h3{font-family:"Playfair Display",Georgia,serif;font-weight:500;margin:0;color:${brand.charcoal}}h1{font-size:54px;line-height:1.02;margin:14px 0}h2{font-size:30px;margin-bottom:12px}h3{font-size:22px;margin-bottom:8px}
  p{margin:0 0 12px}.eyebrow{color:${brand.gold};text-transform:uppercase;font-size:12px;letter-spacing:0}.lede{font-family:Lora,Georgia,serif;color:${brand.muted};font-size:18px}.divider{width:104px;height:2px;background:${brand.gold};margin:22px auto}
  .primary-logo{width:190px;max-height:132px;object-fit:contain}.horizontal-logo{width:176px;max-height:44px;object-fit:contain}.doc-header{display:flex;justify-content:space-between;gap:28px;align-items:center;border-bottom:1px solid ${brand.champagne};background:${brand.white}}
  .meta{color:${brand.muted};font-size:12px;text-transform:uppercase}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.field{border-top:1px solid ${brand.taupe};padding-top:10px}.field span{display:block;color:${brand.gold};font-size:11px;text-transform:uppercase}.field strong{display:block;font-weight:600;margin-top:4px}
  .section{border-top:1px solid ${brand.taupe}}.badge{display:inline-block;border:1px solid ${brand.gold};color:${brand.charcoal};padding:4px 9px;font-size:11px;text-transform:uppercase;margin-left:8px}.total{font-family:"Playfair Display",Georgia,serif;font-size:32px;color:${brand.charcoal};text-align:right}.next{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.next div{border-left:2px solid ${brand.gold};padding-left:12px;color:${brand.muted}}.next strong{display:block;color:${brand.charcoal};font-size:16px}
  table{width:100%;border-collapse:collapse;margin-top:14px}td,th{border-bottom:1px solid ${brand.taupe};padding:12px 8px;text-align:left}th{color:${brand.muted};font-size:11px;text-transform:uppercase}td:last-child,th:last-child{text-align:right}.summary{margin-left:auto;width:min(340px,100%)}.summary td{border:0;padding:5px 0}.summary tr:last-child td{border-top:1px solid ${brand.gold};padding-top:10px;font-weight:700}.footer{text-align:center;background:${brand.ivory};color:${brand.muted};font-size:13px}
  </style></head><body>
  <main>
  <section class="cover">${primaryLogo ? `<img class="primary-logo" src="${primaryLogo}" alt="The LOLA Booth">` : "<p class=\"eyebrow\">THE LOLA BOOTH</p>"}<div class="divider"></div><p class="eyebrow">Event Proposal</p><h1>Proposal for ${proposal.client_name || "Client"}</h1><p class="lede">${proposal.event_type || "Event"} · ${proposal.event_date || "Date TBD"} · ${proposal.venue_name || "Venue TBD"}</p><p class="meta">${proposal.proposal_number} · Prepared ${new Date().toISOString().slice(0, 10)} · Valid through ${proposal.valid_through || "TBD"}</p><p>Your event. Their favorite memory.</p></section>
  <section class="doc-header">${horizontalLogo ? `<img class="horizontal-logo" src="${horizontalLogo}" alt="The LOLA Booth">` : "<strong>THE LOLA BOOTH</strong>"}<p class="meta">${proposal.proposal_number}<br>Good people. Better photos.</p></section>
  <section><h2>Your event. Their favorite memory.</h2><div>${sanitizeContent(content.introduction)}</div></section>
  <section class="section"><h2>Event Summary</h2><div class="grid">${eventRows.map(([label, value]) => `<div class="field"><span>${label}</span><strong>${value}</strong></div>`).join("")}</div></section>
  <section class="section"><p class="eyebrow">Your LOLA Experience</p><h2>${content.experienceName || proposal.experience_name || "Photo Booth Experience"}</h2><div>${sanitizeContent(content.experienceDescription)}</div></section>
  <section class="section"><p class="eyebrow">Your Package</p><h2>${content.packageName || proposal.package_name || "Selected Package"}${content.packageMostPopular ? '<span class="badge">MOST POPULAR</span>' : ""}</h2><div>${sanitizeContent(content.packageDescription)}</div></section>
  <section class="section"><h2>Your Investment</h2><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead><tbody>${lineItems.map((item) => `<tr><td>${item.description}</td><td>${item.quantity}</td><td>${money(item.unit_price)}</td><td>${money(item.line_total)}</td></tr>`).join("")}</tbody></table><table class="summary"><tbody><tr><td>Subtotal</td><td>${money(pricing.subtotal || pricing.total)}</td></tr><tr><td>Discount</td><td>${money(pricing.discount)}</td></tr><tr><td>Tax</td><td>${money(pricing.tax)}</td></tr><tr><td>Total</td><td>${money(pricing.total)}</td></tr><tr><td>Deposit</td><td>${money(pricing.deposit_amount)}</td></tr><tr><td>Balance</td><td>${money(pricing.balance)}</td></tr></tbody></table><p class="total">Amount Due ${money(pricing.deposit_amount || pricing.total)}</p></section>
  <section class="section"><h2>What Happens Next</h2><div class="next"><div><strong>01</strong>Review</div><div><strong>02</strong>Accept proposal</div><div><strong>03</strong>Deposit invoice</div><div><strong>04</strong>Planning details</div><div><strong>05</strong>Event day</div><div><strong>06</strong>Gallery delivery</div></div><div>${sanitizeContent(content.nextSteps)}</div></section>
  <section class="section"><h2>Terms / Notes</h2><div>${sanitizeContent(content.terms)}</div></section>
  <section class="footer"><h2>Let's make it official.</h2><p>Good people. Better photos.<br>THE LOLA BOOTH</p></section>
  </main></body></html>`;
}

function drawBrandPage(doc, title, subtitle, { asset = "primaryDark", label = "" } = {}) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(brand.ivory);
  const selectedLogo = logoPath(asset);
  if (selectedLogo) {
    const width = asset === "horizontalDark" ? 178 : 180;
    doc.image(selectedLogo, 48, 56, { width });
  } else {
    doc.fillColor(brand.charcoal).font("Times-Roman").fontSize(34).text("THE LOLA BOOTH", 48, 56);
  }
  doc.fillColor(brand.gold).font("Helvetica").fontSize(10).text(label || "THE LOLA BOOTH", 50, 218, { characterSpacing: 1.4 });
  doc.fillColor(brand.charcoal).font("Times-Roman").fontSize(32).text(title, 48, 240, { width: doc.page.width - 96 });
  doc.fillColor(brand.gold).font("Helvetica").fontSize(11).text("Good people. Better photos.", 50, 302);
  doc.moveTo(48, 282).lineTo(doc.page.width - 48, 282).strokeColor("#d8d0c2").stroke();
  doc.moveTo(48, 328).lineTo(doc.page.width - 48, 328).strokeColor(brand.champagne).stroke();
  doc.fillColor(brand.muted).font("Helvetica").fontSize(13).text(subtitle, 50, 354, { width: doc.page.width - 100 });
}

export async function generateProposalPdf(proposal) {
  const chunks = [];
  const doc = new PDFDocument({ size: "LETTER", margin: 48 });
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  drawBrandPage(doc, `Proposal for ${proposal.client_name || "Client"}`, `${proposal.event_type || ""} · ${proposal.event_date || ""} · ${proposal.venue_name || ""}`, { asset: "primaryDark", label: "EVENT PROPOSAL" });
  doc.addPage();
  addProposalBody(doc, proposal);
  doc.end();
  return done;
}

function addProposalBody(doc, proposal) {
  const content = proposal.content || {};
  const pricing = proposal.pricing_snapshot || {};
  doc.font("Times-Roman").fontSize(22).fillColor(brand.charcoal).text("Your event. Their favorite memory.");
  doc.moveDown().font("Helvetica").fontSize(11).fillColor(brand.muted).text(`${proposal.proposal_number} · Valid through ${proposal.valid_through || ""}`);
  doc.moveDown().font("Times-Roman").fontSize(18).fillColor(brand.charcoal).text("Event Summary");
  doc.font("Helvetica").fontSize(11).text(`${proposal.event_name || ""}\n${proposal.event_date || ""} ${proposal.start_time || ""}-${proposal.end_time || ""}\n${proposal.venue_name || ""}`);
  doc.moveDown().font("Times-Roman").fontSize(18).text("Your LOLA Experience");
  doc.font("Helvetica-Bold").fontSize(12).text(content.experienceName || proposal.experience_name || "");
  doc.font("Helvetica").fontSize(11).text(strip(content.experienceDescription));
  doc.moveDown().font("Times-Roman").fontSize(18).text("Your Package");
  doc.font("Helvetica-Bold").fontSize(12).text(`${content.packageName || proposal.package_name || ""}${content.packageMostPopular ? "  MOST POPULAR" : ""}`);
  doc.font("Helvetica").fontSize(11).text(strip(content.packageDescription));
  doc.moveDown().font("Times-Roman").fontSize(18).text("Your Investment");
  for (const item of proposal.line_items_snapshot || []) {
    doc.font("Helvetica").fontSize(10).text(`${item.description} x ${item.quantity}   ${money(item.line_total)}`);
  }
  doc.moveDown().font("Helvetica-Bold").fontSize(16).fillColor(brand.charcoal).text(`Total ${money(pricing.total)}`);
  doc.fillColor(brand.gold).font("Helvetica").fontSize(11).text(`Deposit ${money(pricing.deposit_amount)} · Balance ${money(pricing.balance)}`);
  doc.moveDown().font("Times-Roman").fontSize(18).text("What Happens Next");
  doc.font("Helvetica").fontSize(11).text(strip(content.nextSteps));
  doc.moveDown().font("Times-Roman").fontSize(18).text("Terms / Notes");
  doc.font("Helvetica").fontSize(11).text(strip(content.terms));
}

export async function generateProposalDocx(proposal) {
  const pricing = proposal.pricing_snapshot || {};
  const logo = logoBuffer("primaryDark");
  const rows = (proposal.line_items_snapshot || []).map((item) => new TableRow({
    children: [item.description, String(item.quantity), money(item.unit_price), money(item.line_total)].map((text) => new TableCell({ children: [new Paragraph(text)] }))
  }));
  const doc = new Document({
    sections: [{
      children: [
        ...(logo ? [new Paragraph({ children: [new ImageRun({ data: logo, transformation: { width: 175, height: 120 } })] })] : []),
        heading("THE LOLA BOOTH"),
        new Paragraph("Good people. Better photos."),
        heading(`EVENT PROPOSAL FOR ${proposal.client_name || "Client"}`),
        new Paragraph(`${proposal.event_type || ""} · ${proposal.event_date || ""}`),
        heading("Your event. Their favorite memory."), new Paragraph(strip(proposal.content?.introduction)),
        heading("Event Summary"), new Paragraph(`${proposal.event_name || ""}\n${proposal.venue_name || ""}`),
        heading("Your LOLA Experience"), new Paragraph(strip(proposal.content?.experienceDescription)),
        heading("Your Package"), new Paragraph(strip(proposal.content?.packageDescription)),
        heading("Your Investment"),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
        new Paragraph({ children: [new TextRun({ text: `Total ${money(pricing.total)}`, bold: true })] }),
        heading("Next Steps"), new Paragraph(strip(proposal.content?.nextSteps)),
        heading("Terms"), new Paragraph(strip(proposal.content?.terms))
      ]
    }]
  });
  return Packer.toBuffer(doc);
}

export async function generateInvoicePdf(invoice) {
  const chunks = [];
  const doc = new PDFDocument({ size: "LETTER", margin: 48 });
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  drawBrandPage(doc, `Invoice ${invoice.invoice_number}`, `${invoice.client_name || ""} · Amount Due ${money(invoice.amount_outstanding || invoice.balance_due)}`, { asset: "primaryDark", label: "INVOICE" });
  doc.addPage();
  doc.font("Times-Roman").fontSize(22).fillColor(brand.charcoal).text("Invoice");
  doc.font("Helvetica").fontSize(11).text(`Issue Date: ${invoice.issue_date || ""}\nDue Date: ${invoice.due_date || ""}\nStatus: ${invoice.status}`);
  doc.moveDown().font("Times-Roman").fontSize(18).text("Bill To");
  doc.font("Helvetica").fontSize(11).text(`${invoice.client_name || ""}\n${invoice.client_email || ""}`);
  doc.moveDown().font("Times-Roman").fontSize(18).text("Event");
  doc.font("Helvetica").fontSize(11).text(`${invoice.event_name || ""}\n${invoice.event_date || ""}\n${invoice.venue_name || ""}`);
  doc.moveDown().font("Times-Roman").fontSize(18).text("Line Items");
  for (const item of invoice.items || []) doc.font("Helvetica").fontSize(10).text(`${item.label || item.description} x ${item.quantity}   ${money(item.line_total || item.total)}`);
  doc.moveDown().font("Helvetica").fontSize(11).fillColor(brand.muted).text(`Subtotal ${money(invoice.subtotal)} · Discount ${money(invoice.discount)} · Tax ${money(invoice.tax)}`);
  doc.font("Helvetica-Bold").fontSize(18).fillColor(brand.charcoal).text(`Amount Due ${money(invoice.amount_outstanding || invoice.balance_due)}`);
  doc.fillColor(brand.muted).font("Helvetica").fontSize(11).text(`Total ${money(invoice.total)} · Paid ${money(invoice.amount_paid)}`);
  doc.moveDown().text(invoice.terms || "");
  doc.moveDown().fillColor(brand.gold).font("Helvetica-Bold").text("Good people. Better photos.");
  doc.end();
  return done;
}

export async function generatePaymentReceiptPdf(payment) {
  const chunks = [];
  const doc = new PDFDocument({ size: "LETTER", margin: 48 });
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  drawBrandPage(doc, `Receipt ${payment.id.slice(0, 8).toUpperCase()}`, `${payment.client_name || ""} · ${money(payment.amount)}`, { asset: "primaryDark", label: "RECEIPT" });
  doc.addPage();
  doc.font("Times-Roman").fontSize(22).fillColor(brand.charcoal).text("Payment Receipt");
  doc.moveDown().font("Helvetica").fontSize(11).fillColor(brand.charcoal);
  doc.text(`Receipt #: ${payment.id.slice(0, 8).toUpperCase()}`);
  doc.text(`Client: ${payment.client_name || ""}`);
  doc.text(`Event: ${payment.event_name || ""}`);
  doc.text(`Invoice: ${payment.invoice_number || ""}`);
  doc.text(`Payment Date: ${payment.payment_date || payment.paid_at || ""}`);
  doc.text(`Payment Method: ${payment.payment_method || payment.provider}`);
  doc.text(`Amount: ${money(payment.amount)}`);
  doc.text(`Refunded: ${money(payment.refunded_amount || 0)}`);
  doc.text(`Remaining Balance: ${money(payment.invoice_balance || 0)}`);
  doc.moveDown().fillColor(brand.gold).font("Helvetica-Bold").text("Good people. Better photos.");
  doc.end();
  return done;
}

export async function storeDocument({ buffer, filename, mimeType }) {
  const storage = getStorageProvider();
  const stored = await storage.put({ buffer, filename });
  return { ...stored, filename, mimeType, sizeBytes: buffer.length };
}

function heading(text) {
  return new Paragraph({ children: [new TextRun({ text, bold: true, size: 32 })], spacing: { before: 240, after: 120 } });
}

function strip(value) {
  return sanitizeContent(value).replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n");
}
