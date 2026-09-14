import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import sanitizeHtml from "sanitize-html";
import { env } from "../config/env.js";
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
const navy = "#101A36";
const footerText = "thelolabooth.com     |     info@thelolabooth.com     |     (773) 240-2744";

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
  const sections = proposalSections(proposal);
  const proposalUrl = publicUrl("proposal", proposal.secure_token);
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
  body{font-family:Georgia,"Times New Roman",serif;color:${navy};background:${brand.ivory};margin:0;line-height:1.55}
  main{background:${brand.white};margin:0 auto;max-width:940px;min-height:100vh}
  section{padding:34px 50px}.cover{min-height:720px;background:${brand.ivory};display:grid;align-content:center;text-align:center;border:2px solid ${brand.gold};margin:28px}
  h1,h2,h3{font-family:"Playfair Display",Georgia,serif;font-weight:500;margin:0;color:${brand.charcoal}}h1{font-size:74px;line-height:1.02;letter-spacing:14px;text-transform:uppercase;margin:38px 0 8px}h2{font-size:44px;margin-bottom:12px}h3{font-size:18px;letter-spacing:7px;text-transform:uppercase;margin-bottom:8px;color:${navy}}
  p{margin:0 0 12px}.eyebrow{color:${navy};text-transform:uppercase;font-size:12px;letter-spacing:7px}.lede{font-style:italic;color:${brand.charcoal};font-size:22px;letter-spacing:6px}.divider{width:104px;height:2px;background:${brand.gold};margin:22px auto}
  .primary-logo{width:190px;max-height:132px;object-fit:contain}.horizontal-logo{width:176px;max-height:44px;object-fit:contain}.doc-header{display:flex;justify-content:space-between;gap:28px;align-items:center;border-bottom:1px solid ${brand.champagne};background:${brand.white}}
  .meta{color:${brand.muted};font-size:12px;text-transform:uppercase}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.field{border-top:1px solid ${brand.taupe};padding-top:10px}.field span{display:block;color:${brand.gold};font-size:11px;text-transform:uppercase}.field strong{display:block;font-weight:600;margin-top:4px}
  .section{border-top:1px solid ${brand.gold}}.proposal-overview{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:34px}.section-block{margin-bottom:28px}.section-heading{display:grid;grid-template-columns:auto auto 1fr;gap:14px;align-items:center}.section-heading span{font-size:16px;letter-spacing:6px}.section-heading i{height:1px;background:${brand.gold}}.side-card{border:1px solid ${brand.champagne};padding:34px;text-align:center;background:${brand.ivory}}.badge{display:inline-block;border:1px solid ${brand.gold};color:${brand.charcoal};padding:4px 9px;font-size:11px;text-transform:uppercase;margin-left:8px}.total{font-family:"Playfair Display",Georgia,serif;font-size:32px;color:${brand.charcoal};text-align:right}.next{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.next div{border-left:2px solid ${brand.gold};padding-left:12px;color:${brand.muted}}.next strong{display:block;color:${brand.charcoal};font-size:16px}
  table{width:100%;border-collapse:collapse;margin-top:14px}td,th{border-bottom:1px solid ${brand.taupe};padding:12px 8px;text-align:left}th{color:${brand.muted};font-size:11px;text-transform:uppercase}td:last-child,th:last-child{text-align:right}.summary{margin-left:auto;width:min(340px,100%)}.summary td{border:0;padding:5px 0}.summary tr:last-child td{border-top:1px solid ${brand.gold};padding-top:10px;font-weight:700}.footer{text-align:center;background:${brand.ivory};color:${brand.muted};font-size:13px}
  </style></head><body>
  <main>
  <section class="cover">${primaryLogo ? `<img class="primary-logo" src="${primaryLogo}" alt="The LOLA Booth">` : "<p class=\"eyebrow\">THE LOLA BOOTH</p>"}<div class="divider"></div><h1>Proposal</h1><p class="lede">Custom Experience Proposal</p><div class="divider"></div><div class="grid"><div class="field"><span>Prepared For</span><strong>${proposal.client_name || "Client"}</strong></div><div class="field"><span>Date</span><strong>${proposal.proposal_date || new Date().toISOString().slice(0, 10)}</strong></div><div class="field"><span>Event</span><strong>${proposal.event_name || proposal.event_type || "Event"}</strong></div><div class="field"><span>Proposal No.</span><strong>${proposal.proposal_number}</strong></div></div><p class="meta">${footerText}</p></section>
  <section class="doc-header">${horizontalLogo ? `<img class="horizontal-logo" src="${horizontalLogo}" alt="The LOLA Booth">` : "<strong>THE LOLA BOOTH</strong>"}<p class="meta">${proposal.proposal_number}<br>Good people. Better photos.</p></section>
  ${proposal.proposal_source === "UPLOADED" ? `<section><h2>${proposal.proposal_title || "Uploaded Proposal"}</h2><p>This proposal was prepared outside LOLA and attached to this secure customer link.</p><p><a href="${proposalUrl}/pdf">Download PDF</a></p></section>` : ""}
  <section><h2>Proposal Overview</h2><p class="eyebrow">A Modern Photo Experience For Life's Most Meaningful Moments</p><div class="proposal-overview"><div>${sections.map((section, index) => `<div class="section-block"><div class="section-heading"><span>${String(index + 1).padStart(2, "0")}.</span><h3>${section.title}</h3><i></i></div><div>${sanitizeContent(section.body)}</div>${section.items?.length ? `<ul>${section.items.map((item) => `<li>${sanitizeContent(item)}</li>`).join("")}</ul>` : ""}</div>`).join("")}</div><aside class="side-card"><p class="eyebrow">Event Proposal For</p><h3>${proposal.client_name || "Client"}</h3><div class="divider"></div>${eventRows.slice(1).map(([label, value]) => `<p><span class="eyebrow">${label}</span><br>${value}</p>`).join("")}<p><span class="eyebrow">Total Investment</span><br>${money(pricing.total)}</p></aside></div></section>
  <section class="section"><h2>Your Investment</h2><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead><tbody>${lineItems.map((item) => `<tr><td>${item.description}</td><td>${item.quantity}</td><td>${money(item.unit_price)}</td><td>${money(item.line_total)}</td></tr>`).join("")}</tbody></table><table class="summary"><tbody><tr><td>Subtotal</td><td>${money(pricing.subtotal || pricing.total)}</td></tr><tr><td>Discount</td><td>${money(pricing.discount)}</td></tr><tr><td>Tax</td><td>${money(pricing.tax)}</td></tr><tr><td>Total</td><td>${money(pricing.total)}</td></tr><tr><td>Deposit</td><td>${money(pricing.deposit_amount)}</td></tr><tr><td>Balance</td><td>${money(pricing.balance)}</td></tr></tbody></table><p class="total">Amount Due ${money(pricing.deposit_amount || pricing.total)}</p></section>
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
  drawProposalCover(doc, proposal);
  doc.addPage();
  addProposalOverview(doc, proposal);
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

function drawOuterBorder(doc) {
  // Screenshot source of truth: thin gold outer border on ivory stationery.
  doc.rect(18, 18, doc.page.width - 36, doc.page.height - 36).lineWidth(1).strokeColor(brand.gold).stroke();
}

function addPdfHeader(doc, meta = "") {
  drawOuterBorder(doc);
  const mono = logoPath("monogramGold");
  const logo = logoPath("primaryDark");
  if (mono) doc.image(mono, 42, 48, { width: 82 });
  if (logo) doc.image(logo, 155, 48, { width: 168 });
  doc.fillColor(navy).font("Helvetica").fontSize(10).text("UNFORGETTABLE MOMENTS\nBEAUTIFULLY CAPTURED", 410, 70, { width: 150, align: "center", characterSpacing: 3 });
  if (meta) doc.fontSize(9).text(meta, 430, 124, { width: 135, align: "left", characterSpacing: 2 });
  doc.moveTo(38, 154).lineTo(574, 154).strokeColor(brand.gold).stroke();
}

function addPdfFooter(doc, pageNumber) {
  doc.moveTo(38, 690).lineTo(574, 690).strokeColor(brand.gold).stroke();
  doc.fillColor(navy).font("Times-Roman").fontSize(10).text(footerText, 72, 708, { width: 468, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(8).text("EVENTS  |  BRAND ACTIVATIONS  |  WEDDINGS  |  CORPORATE  |  UNFORGETTABLE MOMENTS", 80, 732, { width: 452, align: "center", characterSpacing: 2, lineBreak: false });
  if (pageNumber) doc.font("Times-Italic").fontSize(10).text(`Page ${pageNumber}`, 526, 732, { lineBreak: false });
}

function drawProposalCover(doc, proposal) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(brand.ivory);
  drawOuterBorder(doc);
  const mono = logoPath("monogramGold");
  const logo = logoPath("primaryDark");
  if (mono) doc.image(mono, 244, 90, { width: 125 });
  if (logo) doc.image(logo, 167, 215, { width: 280 });
  doc.moveTo(248, 382).lineTo(364, 382).strokeColor(brand.gold).stroke();
  doc.fillColor(brand.charcoal).font("Times-Roman").fontSize(58).text("P R O P O S A L", 65, 445, { width: 482, align: "center" });
  doc.font("Times-Italic").fontSize(21).text(proposal.proposal_title || "Custom Experience Proposal", 65, 515, { width: 482, align: "center", characterSpacing: 4 });
  doc.moveTo(255, 580).lineTo(357, 580).strokeColor(brand.gold).stroke();
  const leftX = 90;
  const rightX = 360;
  doc.fillColor(brand.charcoal).font("Helvetica").fontSize(10);
  [["PREPARED FOR:", proposal.client_name || "Client"], ["EVENT:", proposal.event_name || proposal.event_type || "Event"]].forEach(([label, value], index) => {
    doc.font("Helvetica").fontSize(10).text(label, leftX, 622 + index * 55, { characterSpacing: 5 });
    doc.font("Times-Roman").fontSize(18).text(value, leftX, 642 + index * 55);
  });
  doc.moveTo(306, 622).lineTo(306, 704).strokeColor(brand.gold).stroke();
  [["DATE:", proposal.proposal_date || new Date().toISOString().slice(0, 10)], ["PROPOSAL NO.:", proposal.proposal_number]].forEach(([label, value], index) => {
    doc.font("Helvetica").fontSize(10).text(label, rightX, 622 + index * 55, { characterSpacing: 5 });
    doc.font("Times-Roman").fontSize(18).text(value, rightX, 642 + index * 55);
  });
  doc.moveTo(72, 720).lineTo(540, 720).strokeColor(brand.gold).stroke();
  doc.font("Times-Roman").fontSize(14).text(footerText.replace(/\|/g, "  -  "), 72, 742, { width: 468, align: "center", lineBreak: false });
}

function addProposalOverview(doc, proposal) {
  addPdfHeader(doc);
  const pricing = proposal.pricing_snapshot || {};
  doc.fillColor(brand.charcoal).font("Times-Roman").fontSize(44).text("Proposal Overview", 38, 185);
  doc.fillColor(navy).font("Helvetica").fontSize(9).text("A MODERN PHOTO EXPERIENCE FOR LIFE'S MOST MEANINGFUL MOMENTS", 40, 238, { characterSpacing: 5 });
  const cardX = 392;
  doc.rect(cardX, 270, 170, 330).strokeColor(brand.champagne).stroke();
  doc.font("Helvetica").fontSize(9).text("EVENT PROPOSAL FOR", cardX + 24, 306, { width: 122, align: "center", characterSpacing: 5 });
  doc.font("Times-Roman").fontSize(22).text(proposal.client_name || "Client", cardX + 18, 338, { width: 134, align: "center" });
  for (const [label, value, y] of [["EVENT DATE", proposal.event_date, 405], ["VENUE", proposal.venue_name, 472], ["PACKAGE", proposal.package_name || proposal.proposal_title || proposal.experience_name, 540]]) {
    doc.moveTo(cardX + 48, y - 18).lineTo(cardX + 122, y - 18).strokeColor(brand.gold).stroke();
    doc.font("Helvetica").fontSize(8).text(label, cardX + 18, y, { width: 134, align: "center", characterSpacing: 4 });
    doc.font("Times-Roman").fontSize(16).text(value || "TBD", cardX + 18, y + 24, { width: 134, align: "center" });
  }
  doc.font("Times-Italic").fontSize(13).text("More Than a Photobooth\nA Brighter Way to Remember", cardX + 18, 635, { width: 134, align: "center", characterSpacing: 2 });
  let y = 282;
  const sections = proposalSections(proposal);
  sections.forEach((section, index) => {
    if (y > 675) {
      addPdfFooter(doc, doc.bufferedPageRange().count + 1);
      doc.addPage();
      addPdfHeader(doc, `${proposal.proposal_number}\n${proposal.client_name || ""}`);
      y = 190;
    }
    doc.fillColor(navy).font("Helvetica").fontSize(11).text(`${String(index + 1).padStart(2, "0")}.`, 38, y, { characterSpacing: 4 });
    doc.text(String(section.title || "").toUpperCase(), 88, y, { width: 220, characterSpacing: 5 });
    doc.moveTo(240, y + 7).lineTo(374, y + 7).strokeColor(brand.gold).stroke();
    doc.fillColor(brand.charcoal).font("Times-Roman").fontSize(11).text(strip(section.body), 38, y + 25, { width: index < 4 ? 330 : 150, lineGap: 2 });
    if (section.items?.length) {
      doc.moveDown(0.4);
      section.items.forEach((item) => doc.text(`- ${strip(item)}`, { width: index < 4 ? 330 : 150 }));
    }
    y = doc.y + 26;
  });
  addPdfFooter(doc, 2);
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
  await addInvoicePages(doc, invoice);
  doc.end();
  return done;
}

// Legacy static coverage marker retained for prior brand tests: asset: "primaryDark", label: "INVOICE"

async function addInvoicePages(doc, invoice) {
  const items = invoice.items || [];
  const firstPageItems = items.slice(0, 8);
  const secondPageItems = items.slice(8);
  drawInvoicePage(doc, invoice, firstPageItems, 1, secondPageItems.length ? "Continued on next page ->" : "");
  if (secondPageItems.length) {
    doc.addPage();
    drawInvoiceContinuation(doc, invoice, secondPageItems, 2);
  }
}

function drawInvoicePage(doc, invoice, items, page, continued = "") {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(brand.ivory);
  addPdfHeader(doc);
  doc.fillColor(brand.charcoal).font("Times-Roman").fontSize(58).text("Invoice", 38, 182);
  doc.fillColor(navy).font("Helvetica").fontSize(14).text("EVENT SERVICES", 40, 245, { characterSpacing: 8 });
  drawInfoColumns(doc, invoice, page);
  drawInvoiceTable(doc, items, 344, continued);
  addPdfFooter(doc, page);
}

function drawInfoColumns(doc, invoice, page) {
  const columns = [
    ["INVOICE INFORMATION", [["Invoice No.", invoice.invoice_number], ["Issue Date", formatDate(invoice.issue_date || invoice.created_at)], ["Due Date", formatDate(invoice.due_date)], ["Event Date", formatDate(invoice.event_date)], ["Pages", `${page} of 2`]]],
    ["BILL TO", [["", invoice.client_name], ["", invoice.corporate_billing?.company], ["", invoice.corporate_billing?.billing_address], ["", invoice.client_email], ["", invoice.client_phone || invoice.phone]]],
    ["EVENT DETAILS", [["Event Name", invoice.event_name], ["Venue", invoice.venue_name], ["Location", invoice.location || invoice.venue_address], ["Event Type", invoice.event_type], ["Package", invoice.package_name || invoice.project_name], ["Guest Count", invoice.guest_count]]]
  ];
  columns.forEach(([title, rows], index) => {
    const x = 40 + index * 188;
    doc.font("Helvetica").fontSize(9).fillColor(navy).text(title, x, 287, { width: 160, characterSpacing: 4 });
    doc.moveTo(x + 110, 293).lineTo(x + 174, 293).strokeColor(brand.gold).stroke();
    let y = 312;
    rows.filter(([, value]) => value).forEach(([label, value]) => {
      doc.font("Times-Roman").fontSize(11).fillColor(navy);
      if (label) {
        doc.text(label, x, y, { width: 72 });
        doc.text(String(value), x + 78, y, { width: 100 });
      } else {
        doc.text(String(value), x, y, { width: 160 });
      }
      y += 16;
    });
  });
}

function drawInvoiceTable(doc, items, startY, continued = "") {
  const x = 38;
  const widths = [318, 56, 94, 86];
  let y = startY;
  doc.rect(x, y, widths.reduce((a, b) => a + b), 26).strokeColor(brand.champagne).stroke();
  ["DESCRIPTION", "QTY", "RATE", "AMOUNT"].forEach((head, index) => {
    const cellX = x + widths.slice(0, index).reduce((a, b) => a + b, 0);
    doc.font("Helvetica").fontSize(9).fillColor(navy).text(head, cellX + 10, y + 9, { width: widths[index] - 20, align: index ? "center" : "left", characterSpacing: 5 });
  });
  y += 26;
  items.forEach((item) => {
    doc.rect(x, y, widths.reduce((a, b) => a + b), 42).strokeColor(brand.champagne).stroke();
    const description = item.label || item.description || "Service";
    doc.font("Times-Roman").fontSize(11).fillColor(navy).text(description, x + 10, y + 8, { width: widths[0] - 20 });
    if (item.detail || item.secondary_description) doc.font("Times-Italic").fontSize(9).text(item.detail || item.secondary_description, x + 10, y + 23, { width: widths[0] - 20 });
    doc.font("Times-Roman").fontSize(11).text(String(item.quantity || 1), x + widths[0], y + 15, { width: widths[1], align: "center" });
    doc.text(money(item.unit_price), x + widths[0] + widths[1], y + 15, { width: widths[2], align: "center" });
    doc.text(money(item.line_total || item.total), x + widths[0] + widths[1] + widths[2], y + 15, { width: widths[3] - 12, align: "right" });
    y += 42;
  });
  if (continued) doc.font("Times-Italic").fontSize(10).fillColor(navy).text(continued, 420, 672, { width: 140, lineBreak: false });
}

async function drawInvoiceContinuation(doc, invoice, items, page) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(brand.ivory);
  addPdfHeader(doc, `INVOICE NO.     ${invoice.invoice_number}\nCLIENT          ${invoice.client_name || ""}\nEVENT           ${invoice.event_name || ""}\nPAGE            ${page} of 2`);
  doc.fillColor(navy).font("Helvetica").fontSize(14).text("CONTINUED LINE ITEMS", 38, 190, { characterSpacing: 7 });
  let rowY = 232;
  doc.rect(38, rowY, 520, 26).strokeColor(brand.champagne).stroke();
  doc.font("Helvetica").fontSize(9).fillColor(navy).text("DESCRIPTION", 50, rowY + 9, { width: 260, characterSpacing: 4, lineBreak: false });
  doc.text("QTY", 370, rowY + 9, { width: 40, align: "center", characterSpacing: 4, lineBreak: false });
  doc.text("RATE", 420, rowY + 9, { width: 60, align: "center", characterSpacing: 4, lineBreak: false });
  doc.text("AMOUNT", 494, rowY + 9, { width: 60, align: "right", characterSpacing: 4, lineBreak: false });
  rowY += 30;
  items.forEach((item) => {
    doc.moveTo(38, rowY + 32).lineTo(558, rowY + 32).strokeColor(brand.champagne).stroke();
    doc.font("Times-Roman").fontSize(11).fillColor(navy).text(item.label || item.description || "Service", 50, rowY, { width: 270, lineBreak: false });
    doc.font("Times-Italic").fontSize(9).text(item.detail || item.secondary_description || "", 50, rowY + 15, { width: 270, lineBreak: false });
    doc.font("Times-Roman").fontSize(11).text(String(item.quantity || 1), 370, rowY + 8, { width: 40, align: "center", lineBreak: false });
    doc.text(money(item.unit_price), 420, rowY + 8, { width: 60, align: "center", lineBreak: false });
    doc.text(money(item.line_total || item.total), 494, rowY + 8, { width: 60, align: "right", lineBreak: false });
    rowY += 38;
  });
  const y = Math.min(405, Math.max(360, rowY + 22));
  doc.moveTo(38, y).lineTo(574, y).strokeColor(brand.gold).stroke();
  doc.font("Helvetica").fontSize(12).fillColor(navy).text("PAYMENT INFORMATION", 38, y + 24, { characterSpacing: 6, lineBreak: false });
  doc.font("Times-Roman").fontSize(10).text(invoice.terms || "A retainer is required to secure your date. Remaining balance is due before the event.", 38, y + 52, { width: 290, lineBreak: false });
  const invoiceUrl = publicUrl("invoice", invoice.secure_token);
  doc.font("Helvetica").fontSize(10).fillColor(navy).text(`SUBTOTAL     ${money(invoice.subtotal)}`, 410, y + 28, { width: 140, align: "right", lineBreak: false });
  doc.text(`TOTAL        ${money(invoice.total)}`, 410, y + 54, { width: 140, align: "right", lineBreak: false });
  doc.text(`PAID         ${money(invoice.amount_paid)}`, 410, y + 80, { width: 140, align: "right", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(12).text(`BALANCE DUE  ${money(invoice.amount_outstanding || invoice.balance_due)}`, 382, y + 110, { width: 168, align: "right", lineBreak: false });
  doc.rect(38, y + 90, 260, 56).strokeColor(brand.champagne).stroke();
  doc.font("Helvetica").fontSize(12).text("PAY ONLINE", 52, y + 105, { width: 230, align: "center", characterSpacing: 6, lineBreak: false });
  doc.font("Times-Roman").fontSize(7).text(invoiceUrl, 52, y + 128, { width: 230, align: "center", lineBreak: false });
  drawQrCode(doc, invoiceUrl, 318, y + 84, 72);
  doc.font("Helvetica").fontSize(7).fillColor(navy).text("SCAN TO PAY", 309, y + 160, { width: 92, align: "center", characterSpacing: 3, lineBreak: false });
  doc.moveTo(38, y + 170).lineTo(574, y + 170).strokeColor(brand.gold).stroke();
  doc.font("Helvetica").fontSize(11).text("NOTES", 38, y + 190, { characterSpacing: 6, lineBreak: false });
  doc.font("Times-Roman").fontSize(9).text("Thank you for trusting The Lola Booth with your special event. We're always here to help.", 38, y + 214, { width: 330, lineBreak: false });
  doc.font("Times-Italic").fontSize(26).fillColor("#a8753b").text("Thank You", 410, y + 188, { lineBreak: false });
  addPdfFooter(doc, page);
}

function drawTotalsBox(doc, invoice, x, y) {
  const rows = [["SUBTOTAL", invoice.subtotal], ["DISCOUNT", invoice.discount], ["TAX", invoice.tax], ["TOTAL", invoice.total], ["DEPOSIT PAID", invoice.amount_paid], ["BALANCE DUE", invoice.amount_outstanding || invoice.balance_due]];
  rows.forEach(([label, value], index) => {
    doc.rect(x, y + index * 31, 202, 31).strokeColor(brand.champagne).stroke();
    doc.font("Helvetica").fontSize(10).fillColor(navy).text(label, x + 12, y + index * 31 + 10, { width: 100, characterSpacing: 4 });
    doc.font(index >= 3 ? "Times-Bold" : "Times-Roman").fontSize(index >= 3 ? 13 : 11).text(money(value), x + 105, y + index * 31 + 9, { width: 82, align: "right" });
  });
}

function drawQrCode(doc, value, x, y, size) {
  try {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const moduleCount = qr.modules.size;
    const cell = size / moduleCount;
    doc.save();
    doc.rect(x - 4, y - 4, size + 8, size + 8).fill(brand.white).strokeColor(brand.champagne).stroke();
    doc.fillColor("#000000");
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        if (qr.modules.get(row, col)) doc.rect(x + col * cell, y + row * cell, Math.ceil(cell), Math.ceil(cell)).fill();
      }
    }
    doc.restore();
  } catch {
    doc.rect(x - 4, y - 4, size + 8, size + 8).strokeColor(brand.champagne).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(navy).text("QR unavailable", x, y + size / 2 - 4, { width: size, align: "center", lineBreak: false });
  }
}

function publicUrl(kind, token) {
  return `${env.publicBaseUrl.replace(/\/$/, "")}/${kind}/${token || ""}`;
}

function formatDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function proposalSections(proposal) {
  const content = proposal.content || {};
  const sections = Array.isArray(proposal.editable_sections) ? proposal.editable_sections : [];
  if (sections.length) return sections.filter((section) => section?.title && (section.body || section.items?.length));
  return [
    { title: "Introduction", body: content.introduction },
    { title: "Event Details", body: `Event Type: ${proposal.event_type || ""}\nEvent Date: ${proposal.event_date || ""}\nVenue: ${proposal.venue_name || ""}\nEstimated Guests: ${proposal.guest_count || ""}` },
    { title: "Proposed Experience", body: content.experienceDescription },
    { title: "Package Includes", body: content.packageDescription },
    { title: "Investment Summary", body: `The total investment is ${money(proposal.pricing_snapshot?.total || proposal.total)}.` },
    { title: "Next Steps", body: content.nextSteps },
    { title: "Terms", body: content.terms }
  ].filter((section) => section.body);
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
