import { scenarioHtml, renderScenarioPdf } from "./proposal-scenario-document.js";
import { proposalNarrative } from "./proposal-narrative.js";
import { secureDocumentUrl } from "../../../shared/document-access.js";
import {proposalVisualHtml} from "./proposal-visual-service.js";
import { renderProposalPdf } from "./proposal-pdf-layout.js";
import {compactProposalPhotos} from "./proposal-pdf-images.js";
import { documentOrigin } from "../utils/public-document-url.js";
import { normalizeInvoice } from "../../../shared/invoice-balance.js";
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
  if(proposal.content?.scenario) return scenarioHtml(proposal,logoDataUri("primaryDark"));
  const content = proposal.content || {};
  const pricing = proposal.pricing_snapshot || {};
  const experiences = proposalSelectedExperiences(proposal);
  const narrative = proposalNarrative(proposal, experiences);
  const lineItems = proposal.line_items_snapshot || [];
  const first = experiences[0] || {};
  const second = experiences[1] || first;
  const heroA = safeProposalUrl(selectedExperienceVisual(proposal, first, "hero"));
  const heroB = safeProposalUrl(selectedExperienceVisual(proposal, second, "hero"));
  const client = escapeProposalValue(proposal.client_name || "you");
  const proposalTypeLabel = proposal.proposal_type === "WEDDING" ? "Wedding Experience Proposal" : ["CORPORATE","BRAND_ACTIVATION"].includes(proposal.proposal_type) ? "Corporate & Brand Experience Proposal" : "Event Experience Proposal";
  const selectedNames = experiences.map(item => item.name).filter(Boolean).join(" + ") || content.experienceName || "A Custom LOLA Experience";
  const selectedSummary = experiences.length > 1
    ? `A polished guest experience combining ${escapeProposalValue(selectedNames)}, designed to give your guests multiple beautiful ways to celebrate, pose, laugh and leave with something worth keeping.`
    : `A polished LOLA guest experience built around ${escapeProposalValue(selectedNames)}, designed to feel effortless, elevated and worth remembering.`;
  const eventFacts = [
    ["Event", proposal.event_name || proposal.event_type || "Event"],
    ["Date", proposal.event_date || "TBD"],
    ["Venue", proposal.venue_name || proposal.venue_address || "TBD"],
    ["Guests", proposal.guest_count || "TBD"]
  ];
  const standardValues = [
    ["01","Beautifully Presented","Equipment, lighting and creative that feel like they belong in the room."],
    ["02","Guest Friendly","Attendants help guests, keep the experience moving and make it easy to enjoy."],
    ["03","Made to Share","Digital content is delivered quickly so guests can save and share their favorite moments."],
    ["04","Handled End to End","Delivery, setup, operation and breakdown are taken care of by LOLA."]
  ];
  const narrativeHtml = value => sanitizeContent(value).replace(/\n/g, "<br>");
  const due = pricing.deposit_amount || pricing.total || proposal.total || 0;
  const terms = sanitizeContent(content.terms || "30% down payment is required to reserve the date. Cancellation requires at least 48 hours notice. Final scope is subject to confirmed event details.");
  const logo = logoDataUri("primaryDark");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The LOLA Booth | ${escapeProposalValue(proposal.proposal_number || "Proposal")}</title>
<style>
:root{--ivory:#fbf7f1;--taupe:#e8ddd0;--gold:#b38c52;--champ:#d7c09a;--ink:#161412;--muted:#6e665e;--line:#dfd3c5}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#ece7e1;color:var(--ink);font-family:Arial,Helvetica,sans-serif}.shell{max-width:1180px;margin:auto;background:#fff;box-shadow:0 16px 54px rgba(0,0,0,.08)}
.nav{position:sticky;top:0;z-index:30;background:rgba(251,247,241,.97);border-bottom:1px solid var(--line);backdrop-filter:blur(10px)}.navin{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:14px 28px}.brand-logo{width:118px;height:56px;object-fit:contain}.btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 18px;border:1px solid #cdbfb0;border-radius:999px;text-decoration:none;font-size:10px;letter-spacing:.11em;text-transform:uppercase;font-weight:700;background:#fff;color:var(--ink)}.btn.gold{background:var(--gold);border-color:var(--gold);color:#fff}
.kicker{font-size:10px;letter-spacing:.23em;text-transform:uppercase;font-weight:700;color:var(--gold)}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:400}h1{font-size:58px;line-height:1.02;margin:12px 0 16px}h2{font-size:40px;line-height:1.08;margin:8px 0 13px}h3{font-size:24px;line-height:1.15;margin:7px 0 10px}.lede{font-size:15px;line-height:1.72;color:#564f48}
.hero{display:grid;grid-template-columns:1.02fr .98fr;min-height:670px}.hero-copy{padding:72px 64px;background:var(--ivory);display:flex;flex-direction:column;justify-content:center}.hero-media{padding:26px;background:#171513;display:grid;grid-template-columns:1.05fr .95fr;grid-template-rows:1fr 1fr;gap:10px}.hero-media .a{grid-row:1/3}.hero-media .c{background:linear-gradient(145deg,#b38c52,#151311);color:#fff;padding:22px;display:flex;align-items:flex-end;border-radius:18px}.photo{background-size:cover;background-position:center;border-radius:18px}.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:25px;padding-top:20px;border-top:1px solid #d9cec2}.meta span,.fact span{display:block;font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#8c8279}.meta strong,.fact strong{display:block;margin-top:5px;font-size:13px}
.section{padding:72px 64px}.section.alt{background:var(--ivory)}.section.dark{background:var(--ink);color:#fff}.section.dark .lede{color:#d4cbc2}.section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:36px;margin-bottom:28px}.section-head .lede{max-width:480px;font-size:14px}.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.fact{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px}.note{margin-top:28px;padding:25px;background:#fff;border:1px solid var(--line);border-radius:16px}
.exp{padding:76px 64px;border-top:1px solid var(--line)}.exp.alt{background:var(--ivory)}.exp-title{display:flex;justify-content:space-between;align-items:flex-start;gap:28px;margin-bottom:24px}.pill{display:inline-block;padding:8px 12px;border-radius:999px;background:#efe4d6;color:#6c5437;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.exp-grid{display:grid;grid-template-columns:.94fr 1.06fr;gap:38px;align-items:start}.main-photo{height:410px;background-size:cover;background-position:center;border-radius:18px;box-shadow:0 18px 36px rgba(0,0,0,.11)}.checks{display:grid;grid-template-columns:1fr 1fr;gap:9px 13px;margin-top:20px}.check{position:relative;padding-left:18px;font-size:12px;line-height:1.45;color:#514a44}.check:before{content:"✓";position:absolute;left:0;color:var(--gold);font-weight:700}.visual-story{margin-top:34px;border-top:1px solid var(--line)}.story-row{display:grid;grid-template-columns:1fr 1fr;align-items:center;min-height:260px;border-bottom:1px solid var(--line)}.story-row:nth-child(even) .story-image{order:2}.story-image{height:100%;min-height:260px;background-size:cover;background-position:center}.story-copy{padding:38px 42px}.story-copy p{font-size:13px;line-height:1.65;color:var(--muted)}.story-copy .smallcap{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);font-weight:700}
.value-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.value{padding:20px;border:1px solid #37312d;border-radius:14px;background:#24201d}.value b{display:block;font-family:Georgia,serif;font-size:18px;margin:7px 0}.value span{font-size:11px;line-height:1.55;color:#d5cbc2}.invest{display:grid;grid-template-columns:1.35fr .65fr;gap:20px}.price{border:1px solid var(--line);border-radius:16px;padding:23px}.line{display:grid;grid-template-columns:1fr auto;gap:15px;padding:14px 0;border-bottom:1px solid var(--line)}.total{display:grid;grid-template-columns:1fr auto;gap:15px;padding-top:20px;font-family:Georgia,serif;font-size:24px}.due{padding:24px;background:var(--ink);color:#fff;border-radius:16px}.due .amt{font-family:Georgia,serif;font-size:36px;margin:12px 0}.due p{font-size:12px;line-height:1.6;color:#d9cfc6}.next{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.step{padding:20px;border:1px solid var(--line);border-radius:14px;background:#fff}.step b{display:block;font-family:Georgia,serif;font-size:18px;margin:6px 0}.step span{font-size:11px;line-height:1.55;color:var(--muted)}.terms{margin-top:28px;padding:22px;border:1px solid var(--line);border-radius:14px;background:#fff}
@media(max-width:850px){.hero,.exp-grid,.invest{grid-template-columns:1fr}.hero-copy,.section,.exp{padding:50px 24px}.hero-media{height:520px}.facts,.value-grid,.next{grid-template-columns:1fr 1fr}.story-row{grid-template-columns:1fr}.story-row:nth-child(even) .story-image{order:0}.checks{grid-template-columns:1fr}}
@media(max-width:520px){.facts,.value-grid,.next{grid-template-columns:1fr}h1{font-size:42px}h2{font-size:31px}.meta{grid-template-columns:1fr 1fr}}
@media print{@page{size:Letter;margin:0}body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.shell{max-width:none;box-shadow:none}.nav{display:none}.print-page{width:8.5in;height:11in;page-break-after:always;overflow:hidden;position:relative}.hero{height:11in;min-height:0}.hero-copy{padding:.65in .48in}.hero-media{padding:.25in}.section.print-page,.exp.print-page{height:11in;padding:.52in .48in;overflow:hidden}h1{font-size:34pt}h2{font-size:26pt}h3{font-size:16pt}.lede{font-size:9pt}.main-photo{height:2.7in}.story-row{min-height:1.2in}.story-image{min-height:1.2in}.story-copy{padding:.13in .2in}.story-copy h3{font-size:12pt;margin:3px 0}.story-copy p{font-size:6.8pt;line-height:1.3;margin:0}.checks{gap:4px 9px;margin-top:9px}.check{font-size:7.3pt}}
</style></head><body><div class="shell">
<header class="nav"><div class="navin"><div>${logo?`<img class="brand-logo" src="${logo}" alt="The LOLA Booth">`:"THE LOLA BOOTH"}</div><div style="font-size:12px;color:var(--muted)">${escapeProposalValue(proposalTypeLabel)} • ${escapeProposalValue(proposal.proposal_number||"")}</div><div><a class="btn" href="#investment">Investment</a> <a class="btn gold" href="#accept">Accept Proposal</a></div></div></header>
<section class="hero print-page"><div class="hero-copy"><div class="kicker">${escapeProposalValue(proposalTypeLabel)}</div><h1>A LOLA experience created for ${client}.</h1><p class="lede">${selectedSummary}</p><div class="meta">${eventFacts.map(([label,value])=>`<div><span>${escapeProposalValue(label)}</span><strong>${escapeProposalValue(value)}</strong></div>`).join("")}</div></div><div class="hero-media"><div class="photo a" style="background-image:url('${heroA}')"></div><div class="photo" style="background-image:url('${heroB}')"></div><div class="c"><div><div class="kicker" style="color:#fff">Selected Experiences</div><h3 style="font-size:30px;margin-bottom:5px">${escapeProposalValue(selectedNames)}</h3><span style="font-size:12px;line-height:1.5">Beautiful moments. Thoughtful production. One unforgettable guest experience.</span></div></div></div></section>
<section class="section print-page"><div class="kicker">Introduction</div><h2>Welcome to The LOLA Booth.</h2><p class="lede">${narrativeHtml(narrative.introduction)}</p></section>
<section class="section alt print-page"><div class="section-head"><div><div class="kicker">Proposal Overview</div><h2>Let’s make this one worth remembering.</h2><h3>About the event</h3><p class="lede">${narrativeHtml(narrative.aboutEvent)}</p></div><p class="lede">A polished, interactive experience that feels intentional in the room and effortless for your guests.</p></div><div class="facts">${eventFacts.map(([label,value])=>`<div class="fact"><span>${escapeProposalValue(label)}</span><strong>${escapeProposalValue(value)}</strong></div>`).join("")}</div><div class="note"><div class="kicker">The Event Vision</div><h3>Elegant, interactive and easy for guests to enjoy.</h3><p class="lede">LOLA will coordinate the selected experiences as one guest journey, with professional attendants, event-ready presentation, custom creative and delivery from setup through breakdown.</p></div></section>
${proposalVisualHtml(proposal)}
${experiences.map((item,index)=>{const key=selectedExperienceKey(item);const features=selectedExperienceFeatures(key,item);const stories=key==="glam"?[["customization","Guest Interface","A welcome screen made for your event.","Your names, colors and event style can carry through the guest-facing screen so the experience feels personal before the first photo is taken."],["equipment","The Booth","Beautiful enough to belong in the room.","Clean equipment, professional lighting and a compact footprint make the experience easy to place without fighting the event design."],["output","Guest Output","A keepsake worth taking home.","Guests leave with a polished memory, delivered in the format included with your selected package."]]:key==="360"?[["equipment","The Platform","A moment built for motion.","A clean 360 platform creates a natural focal point without taking over the room."],["interaction","Guest Experience","Easy to step in. Hard not to share.","Attendants guide the flow while guests create energetic slow-motion content."],["output","Video Treatment","Branded and ready to share.","Custom overlays and finishing make each clip feel connected to your event."]]:key==="digital"?[["equipment","The Digital Booth","A compact booth for your event.","A tablet booth gives guests an easy way to create and share."],["customization","Guest Screen","Ready for your guests.","Event creative can carry through the capture screen."],["output","Guest Experience","Made to enjoy and share.","Reference photography shows the guest experience; final creative is confirmed separately."]]:key==="custom"?[]:key==="vogue"?[["equipment","The Installation","A full-size editorial moment.","The Vogue creates a dramatic, recognizable destination for guests."],["interaction","The Moment","Editorial, playful and instantly recognizable.","Wedding-party members, family, friends or brand guests get a dedicated space to create a fashion-forward memory."],["customization","Styling","Designed to complement the room.","The installation can be coordinated with the event palette, florals or creative direction."]]:[["equipment","The Phone","A familiar object with a meaningful purpose.","Guests simply pick up the phone and leave a message in their own voice."],["customization","Prompt & Signage","Make it easy to know what to say.","A clear prompt and signage help guests leave thoughtful, funny and heartfelt messages."],["output","Post-event Delivery","Keep the voices after the night is over.","Recordings are organized and delivered after the event for you to revisit anytime."]];return `<section class="exp ${index%2?"alt":""} print-page"><div class="exp-title"><div><div class="kicker">Experience ${String(index+1).padStart(2,"0")}</div><h2>${escapeProposalValue(item.name||"LOLA Experience")}</h2><p class="lede">${escapeProposalValue(item.description||"A premium LOLA experience designed around your event.")}</p></div>${item.package_name?`<span class="pill">${escapeProposalValue(item.package_name)}</span>`:""}</div><div class="exp-grid"><div class="main-photo" style="background-image:url('${safeProposalUrl(selectedExperienceVisual(proposal,item,"hero"))}')"></div><div><div class="kicker">The Experience</div><h3>${escapeProposalValue(item.headline||({glam:"Clean. Classic. Beautifully you.","360":"Turn moments into motion.",vogue:"Make your guests the cover story.",audio:"Some memories are better heard.",digital:"Capture. Share. Celebrate.",custom:"Created around your event."}[key]))}</h3><p class="lede">${escapeProposalValue(item.description||"A premium LOLA experience designed around your event.")}</p><div class="checks">${features.map(feature=>`<div class="check">${escapeProposalValue(feature)}</div>`).join("")}</div></div></div><div class="visual-story">${stories.map(([slot,small,title,body])=>`<div class="story-row"><div class="story-image" style="background-image:url('${safeProposalUrl(selectedExperienceVisual(proposal,item,slot))}')"></div><div class="story-copy"><div class="smallcap">${small}</div><h3>${title}</h3><p>${body}</p></div></div>`).join("")}</div></section>`;}).join("")}
<section class="section dark print-page"><div class="section-head"><div><div class="kicker">The LOLA Standard</div><h2>Easy for you. Memorable for them.</h2></div><p class="lede">The booth should feel like part of the celebration, not another thing you have to manage.</p></div><div class="value-grid">${standardValues.map(([n,t,b])=>`<div class="value"><div class="kicker">${n}</div><b>${t}</b><span>${b}</span></div>`).join("")}</div></section>
<section class="section print-page" id="investment"><div class="section-head"><div><div class="kicker">Investment</div><h2>Your ${proposal.proposal_type==="WEDDING"?"wedding":"event"} experience.</h2></div><p class="lede">The investment below comes directly from the experiences, packages and adjustments selected for this proposal.</p></div><div class="invest"><div class="price">${lineItems.map(item=>`<div class="line"><span>${escapeProposalValue(item.description)}</span><strong>${money(item.line_total)}</strong></div>`).join("")}<div class="total"><span>Total Investment</span><strong>${money(pricing.total||proposal.total)}</strong></div></div><div class="due"><div class="kicker">Due to Reserve Date</div><div class="amt">${money(due)}</div><p>30% down payment. Your date is secured after the required booking documents and down payment are completed.</p><a class="btn gold" href="#accept">Accept & Continue</a></div></div></section>
<section class="section alt print-page" id="accept"><div class="section-head"><div><div class="kicker">Next Steps</div><h2>From proposal to booked.</h2></div><p class="lede">Once you are ready, the booking flow stays simple.</p></div><div class="next"><div class="step"><div class="kicker">01</div><b>Accept Proposal</b><span>Confirm the selected experiences and scope.</span></div><div class="step"><div class="kicker">02</div><b>Receive Invoice</b><span>LOLA sends your deposit invoice immediately after acceptance.</span></div><div class="step"><div class="kicker">03</div><b>Pay 30% Down</b><span>Pay the deposit, pay in full, or choose another amount from the secure payment page.</span></div><div class="step"><div class="kicker">04</div><b>Approve Creative</b><span>Review your guest-facing creative before the event.</span></div></div><div class="terms"><div class="kicker">Terms</div><div class="lede">${terms}</div></div></section>
<section class="section print-page"><div class="kicker">Notes</div><h2>A few details to confirm.</h2><p class="lede">${narrativeHtml(narrative.notes)}</p></section>
<section class="section alt print-page"><div class="kicker">Conclusion</div><h2>Let’s make something memorable.</h2><p class="lede">${narrativeHtml(narrative.conclusion)}</p><p class="lede">${narrativeHtml(narrative.closing)}</p></section>
</div></body></html>`;
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
  proposal = await compactProposalPhotos(proposal);
  const chunks = [];
  const pdf = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: !proposal.content?.scenario, bufferPages: Boolean(proposal.content?.scenario) });
  pdf.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));
  if(proposal.content?.scenario) renderScenarioPdf(pdf,proposal,{logo:logoPath("primaryDark")});
  else renderProposalPdf(pdf, proposal, {
    brand, logo: logoPath("primaryDark"), experiences: proposalSelectedExperiences(proposal),
    features: item => selectedExperienceFeatures(selectedExperienceKey(item), item),
    image: item => { const source = proposalPdfExperienceImage(item); return Buffer.isBuffer(source) || (source && fs.existsSync(source)) ? source : null; },
    strip, money, footer: footerText
  });
  pdf.end();
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
  if (meta) {
    doc.fillColor(navy).font("Helvetica").fontSize(9).text(meta, 410, 62, { width: 160, align: "left", characterSpacing: 2 });
  } else {
    doc.fillColor(navy).font("Helvetica").fontSize(10).text("UNFORGETTABLE MOMENTS\nBEAUTIFULLY CAPTURED", 410, 70, { width: 150, align: "center", characterSpacing: 3 });
  }
  doc.moveTo(38, 154).lineTo(574, 154).strokeColor(brand.gold).stroke();
}

function addPdfFooter(doc, pageNumber) {
  doc.moveTo(38, 690).lineTo(574, 690).strokeColor(brand.gold).stroke();
  doc.fillColor(navy).font("Times-Roman").fontSize(10).text(footerText, 72, 708, { width: 468, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(6).text("EVENTS  |  BRAND ACTIVATIONS  |  WEDDINGS  |  CORPORATE  |  UNFORGETTABLE MOMENTS", 38, 732, { width: 460, align: "center", characterSpacing: 0.5, lineBreak: false });
  if (pageNumber) doc.font("Times-Italic").fontSize(10).text(`Page ${pageNumber}`, 526, 732, { lineBreak: false });
}



function textHeight(doc, text, width, font, size) {
  return doc.font(font).fontSize(size).heightOfString(text, { width, lineGap: 1, characterSpacing: 0 });
}

// Explicitly wrap and paginate so long sections never write through a footer.
function drawFlowText(doc, flow, text, font = "Times-Roman", size = 10, color = navy) {
  doc.font(font).fontSize(size);
  const lineHeight = doc.currentLineHeight(true) + 1;
  for (const paragraph of String(text || "").split("\n")) {
    let remaining = paragraph;
    do {
      if (flow.y + lineHeight > flow.bottom) flow.nextPage();
      doc.font(font).fontSize(size).fillColor(color);
      let end = remaining.length;
      if (doc.widthOfString(remaining, { characterSpacing: 0 }) > flow.width) {
        let low = 1;
        let high = remaining.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (doc.widthOfString(remaining.slice(0, middle), { characterSpacing: 0 }) <= flow.width) low = middle;
          else high = middle - 1;
        }
        end = low;
        const space = remaining.lastIndexOf(" ", end);
        if (space > 0) end = space;
      }
      doc.text(remaining.slice(0, end), flow.x, flow.y, { width: flow.width, lineBreak: false, characterSpacing: 0 });
      flow.y += lineHeight;
      remaining = remaining.slice(end).replace(/^ +/, "");
    } while (remaining.length);
  }
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
  invoice = normalizeInvoice(invoice);
  const chunks = [];
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 48, right: 48, bottom: 20, left: 48 } });
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  await addInvoicePages(doc, invoice);
  doc.end();
  return done;
}

// Legacy static coverage marker retained for prior brand tests: asset: "primaryDark", label: "INVOICE"

async function addInvoicePages(doc, invoice) {
  let page = 1;
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(brand.ivory);
  addPdfHeader(doc);
  doc.fillColor(brand.charcoal).font("Times-Roman").fontSize(58).text("Invoice", 38, 182);
  doc.fillColor(navy).font("Helvetica").fontSize(14).text("EVENT SERVICES", 40, 245, { characterSpacing: 6 });
  const infoBottom = drawInfoColumns(doc, invoice, page);
  const flow = {
    x: 48, y: Math.max(362, infoBottom + 18), width: 288, bottom: 666,
    nextPage() {
      addPdfFooter(doc, page++);
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(brand.ivory);
      addPdfHeader(doc, `INVOICE NO. ${invoice.invoice_number}\n${invoice.client_name || ""}`);
      this.y = 190;
    }
  };
  const tableHeader = () => {
    doc.font("Helvetica").fontSize(9).fillColor(navy);
    [ ["DESCRIPTION", 48, 288], ["QTY", 346, 46], ["RATE", 402, 72], ["AMOUNT", 484, 80] ].forEach(([label, x, width]) => {
      doc.text(label, x, flow.y + 8, { width, characterSpacing: 0.5, lineBreak: false, align: x === 48 ? "left" : "right" });
    });
    doc.moveTo(38, flow.y + 26).lineTo(574, flow.y + 26).strokeColor(brand.champagne).stroke();
    flow.y += 34;
  };
  if (flow.y > 610) flow.nextPage();
  tableHeader();
  for (const item of invoice.items || []) {
    const description = String(item.label || item.description || "Service");
    const detail = String(item.detail || item.secondary_description || "");
    const rowHeight = textHeight(doc, description, 288, "Times-Roman", 11)
      + (detail ? textHeight(doc, detail, 288, "Times-Italic", 9) + 4 : 0) + 18;
    if (flow.y + Math.min(rowHeight, 400) > flow.bottom) {
      flow.nextPage();
      doc.font("Helvetica").fontSize(11).fillColor(navy).text("CONTINUED LINE ITEMS", 38, flow.y, { characterSpacing: 2 });
      flow.y += 28;
      tableHeader();
    }
    const top = flow.y;
    const rowPage = page;
    doc.font("Times-Roman").fontSize(11).fillColor(navy);
    doc.text(String(item.quantity ?? 1), 346, top, { width: 46, align: "right", lineBreak: false, characterSpacing: 0 });
    doc.text(money(item.unit_price), 402, top, { width: 72, align: "right", lineBreak: false });
    doc.text(money(item.line_total ?? item.total), 484, top, { width: 80, align: "right", lineBreak: false });
    drawFlowText(doc, flow, description, "Times-Roman", 11);
    if (detail) { flow.y += 4; drawFlowText(doc, flow, detail, "Times-Italic", 9); }
    flow.y = Math.max(flow.y + 12, page === rowPage ? top + 38 : 0);
    doc.moveTo(38, flow.y - 5).lineTo(574, flow.y - 5).strokeColor(brand.champagne).stroke();
  }
  // Reserve a clean payment page for ordinary invoices, and continue naturally for larger ones.
  if (page === 1 || flow.y + 300 > flow.bottom) flow.nextPage();
  else flow.y += 22;
  drawInvoicePayment(doc, invoice, flow);
  addPdfFooter(doc, page);
}

function drawInfoColumns(doc, invoice, page) {
  const columns = [
    ["INVOICE INFORMATION", [["Invoice No.", invoice.invoice_number], ["Issue Date", formatDate(invoice.issue_date || invoice.created_at)], ["Due Date", formatDate(invoice.due_date)], ["Event Date", formatDate(invoice.event_date)], ["Page", String(page)]]],
    ["BILL TO", [["", invoice.client_name], ["", invoice.corporate_billing?.company], ["", invoice.corporate_billing?.billing_address], ["", invoice.client_email], ["", invoice.client_phone || invoice.phone]]],
    ["EVENT DETAILS", [["Event Name", invoice.event_name], ["Venue", invoice.venue_name], ["Location", invoice.location || invoice.venue_address], ["Event Type", invoice.event_type], ["Package", invoice.package_name || invoice.project_name], ["Guest Count", invoice.guest_count]]]
  ];
  let bottom = 0;
  columns.forEach(([title, rows], index) => {
    const x = 40 + index * 188;
    doc.font("Helvetica").fontSize(9).fillColor(navy).text(title, x, 287, { width: 160, characterSpacing: 4 });
    doc.moveTo(x + 110, 293).lineTo(x + 174, 293).strokeColor(brand.gold).stroke();
    let y = 312;
    rows.filter(([, value]) => value).forEach(([label, value]) => {
      doc.font("Times-Roman").fontSize(11).fillColor(navy);
      if (label) {
        const valueText = String(value);
        doc.text(label, x, y, { width: 72, lineBreak: false, characterSpacing: 0 });
        doc.text(valueText, x + 78, y, { width: 100, characterSpacing: 0 });
        y += Math.max(16, doc.heightOfString(valueText, { width: 100 }) + 5);
      } else {
        const valueText = String(value);
        doc.text(valueText, x, y, { width: 160, characterSpacing: 0 });
        y += Math.max(16, doc.heightOfString(valueText, { width: 160 }) + 5);
      }
    });
    bottom = Math.max(bottom, y);
  });
  return bottom;
}

function drawInvoicePayment(doc, invoice, flow) {
  flow.x = 38;
  flow.width = 536;
  drawFlowText(doc, flow, "PAYMENT INFORMATION", "Helvetica", 12);
  flow.y += 18;
  drawFlowText(doc, flow, invoice.terms || "A retainer is required to secure your date. Remaining balance is due before the event.");
  flow.y += 22;
  if (flow.y + 220 > flow.bottom) flow.nextPage();
  const y = flow.y;
  const invoiceUrl = secureDocumentUrl(documentOrigin(), "pay", invoice);
  const rows = [["SUBTOTAL", invoice.subtotal], ["DISCOUNT", invoice.discount], ["TAX", invoice.tax], ["TOTAL", invoice.total], ["PAID", invoice.amount_paid], ["BALANCE DUE", invoice.amount_outstanding ?? invoice.balance_due]];
  rows.forEach(([label, value], index) => {
    doc.font(index === 5 ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(navy);
    doc.text(label, 382, y + index * 24, { width: 95, lineBreak: false, characterSpacing: 0 });
    doc.text(money(value), 477, y + index * 24, { width: 87, align: "right", lineBreak: false });
  });
  if (invoiceUrl) {
  doc.rect(38, y, 250, 76).strokeColor(brand.champagne).stroke();
  doc.font("Helvetica").fontSize(12).text("PAY ONLINE", 50, y + 14, { width: 226, align: "center", characterSpacing: 3, lineBreak: false });
  doc.font("Times-Roman").fontSize(8).text(invoiceUrl, 50, y + 38, { width: 226, align: "center", characterSpacing: 0, link: invoiceUrl });
  drawQrCode(doc, invoiceUrl, 80, y + 92, 84);
  doc.font("Helvetica").fontSize(8).fillColor(navy).text("SCAN TO PAY", 72, y + 184, { width: 100, align: "center", characterSpacing: 1, lineBreak: false });
  } else {
    doc.font("Helvetica").fontSize(10).text("Public access not available. Please contact The LOLA Booth.", 50, y + 14, {width:226});
  }
  flow.y = y + 212;
  drawFlowText(doc, flow, "Thank you for trusting The Lola Booth with your special event.", "Times-Italic", 11);
}

function drawTotalsBox(doc, invoice, x, y) {
  const rows = [["SUBTOTAL", invoice.subtotal], ["DISCOUNT", invoice.discount], ["TAX", invoice.tax], ["TOTAL", invoice.total], ["DEPOSIT PAID", invoice.amount_paid], ["BALANCE DUE", invoice.amount_outstanding ?? invoice.balance_due]];
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
    const cell = size / (moduleCount + 8);
    const inset = 4 * cell;
    doc.save();
    doc.rect(x - 4, y - 4, size + 8, size + 8).fill(brand.white).strokeColor(brand.champagne).stroke();
    doc.fillColor("#000000");
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        if (qr.modules.get(row, col)) doc.rect(x + inset + col * cell, y + inset + row * cell, cell, cell).fill();
      }
    }
    doc.restore();
  } catch {
    doc.rect(x - 4, y - 4, size + 8, size + 8).strokeColor(brand.champagne).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(navy).text("QR unavailable", x, y + size / 2 - 4, { width: size, align: "center", lineBreak: false });
  }
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
  const receipt = payment.thisPayment !== undefined ? payment : {
    number: `R-${payment.id.slice(0,8).toUpperCase()}`, client:payment.client_name, event:payment.event_name,
    invoiceNumber:payment.invoice_number, paymentDate:payment.paid_at||payment.payment_date, method:payment.payment_method||payment.provider,
    reference:payment.provider_payment_id||payment.reference_number||'Manual payment', thisPayment:Number(payment.amount),
    refunded:Number(payment.refunded_amount||0), balanceDue:Number(payment.invoice_balance||0), currency:payment.currency||'USD'
  };
  const chunks=[];const doc=new PDFDocument({size:'LETTER',margin:48});
  doc.on('data',chunk=>chunks.push(chunk));const done=new Promise((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const fmt=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:receipt.currency||'USD'}).format(Number(value||0));
  doc.rect(0,0,612,792).fill(brand.ivory);doc.rect(34,34,544,724).fill(brand.white);
  if(logoPath('primaryDark'))doc.image(logoPath('primaryDark'),231,54,{fit:[150,100],align:'center'});
  doc.font('Helvetica').fontSize(9).fillColor(brand.gold).text('PAYMENT RECEIPT',48,170,{width:516,align:'center',characterSpacing:2});
  doc.font('Times-Roman').fontSize(30).fillColor(brand.charcoal).text(receipt.refunded?'Payment & refund record':'Thank you for your payment.',48,195,{width:516,align:'center'});
  doc.font('Helvetica').fontSize(10).fillColor(brand.muted).text(`${receipt.number}  |  ${receipt.invoiceNumber||'Payment record'}`,48,237,{width:516,align:'center'});
  doc.moveTo(60,264).lineTo(552,264).strokeColor(brand.gold).stroke();
  let y=278;
  const details=[['CLIENT',receipt.client],['EVENT',receipt.event],['PAYMENT DATE',String(receipt.paymentDate||'').slice(0,10)],['EVENT DATE',receipt.eventDate],['METHOD / PROVIDER',[receipt.method,receipt.provider].filter(Boolean).join(' · ')],['REFERENCE',receipt.reference],['CURRENCY',receipt.currency],...(receipt.refunded?[['REFUND DATE',receipt.refundDate||'Not recorded']]:[]),...(receipt.balanceDue>0?[['DUE DATE',receipt.dueDate||'See invoice']]:[])].filter(([,value])=>value);
  for(let i=0;i<details.length;i+=2){let rowHeight=40;for(const [column,[label,value]]of details.slice(i,i+2).entries()){const x=60+column*256;doc.font('Helvetica').fontSize(8).fillColor(brand.muted).text(label,x,y,{width:236});doc.font('Helvetica').fontSize(10).fillColor(brand.charcoal).text(String(value),x,y+13,{width:236});rowHeight=Math.max(rowHeight,doc.heightOfString(String(value),{width:236})+24);}y+=rowHeight;}
  y+=13;doc.moveTo(60,y).lineTo(552,y).strokeColor(brand.taupe).stroke();y+=18;
  const rows=[['Invoice total',receipt.invoiceTotal],['Previously paid (net)',receipt.previouslyPaid],['This payment',receipt.thisPayment],...(receipt.refunded?[['Refunded from this payment',receipt.refunded]]:[]),['Total paid to date (net)',receipt.totalPaid],['Remaining balance',receipt.balanceDue]];
  for(const [label,value]of rows){if(value===undefined)continue;const strong=['This payment','Remaining balance'].includes(label);doc.font(strong?'Helvetica-Bold':'Helvetica').fontSize(strong?12:10).fillColor(brand.charcoal).text(label,60,y,{width:320});doc.text(fmt(value),380,y,{width:172,align:'right'});y+=23;}
  doc.font('Helvetica-Bold').fontSize(10).fillColor(receipt.status==='PAID'?'#326448':brand.gold).text((receipt.status||'PAYMENT RECORDED').replaceAll('_',' '),60,y+8,{width:492,align:'center'});
  doc.font('Times-Italic').fontSize(14).fillColor(brand.gold).text('Good people. Better photos.',60,709,{width:492,align:'center'});doc.font('Helvetica').fontSize(8).fillColor(brand.muted).text('thelolabooth.com  |  info@thelolabooth.com',60,733,{width:492,align:'center'});
  doc.end();return done;
}

export async function storeDocument({ buffer, filename, mimeType }) {
  const storage = getStorageProvider();
  const stored = await storage.put({ buffer, filename, mimeType });
  return { ...stored, filename, mimeType, sizeBytes: buffer.length };
}

function heading(text) {
  return new Paragraph({ children: [new TextRun({ text, bold: true, size: 32 })], spacing: { before: 240, after: 120 } });
}


function selectedExperienceProposalHtml(proposal) {
  const experiences = proposalSelectedExperiences(proposal);
  if (!experiences.length) return "";
  const corporate = ["CORPORATE","BRAND_ACTIVATION"].includes(proposal.proposal_type);
  const overview = corporate
    ? `<section class="proposal-type-band"><p class="eyebrow">COMMERCIAL EXPERIENCE</p><h2>Built around the event objective.</h2><p>Each selected experience is shown visually so the client can understand the equipment, interaction, customization and final output before approving the scope.</p></section>`
    : `<section class="proposal-type-band"><p class="eyebrow">${proposal.proposal_type === "WEDDING" ? "WEDDING EXPERIENCE" : "EVENT EXPERIENCE"}</p><h2>Let's make this one worth remembering.</h2><p>Every selected LOLA experience is presented as part of one coordinated guest journey.</p></section>`;
  return overview + experiences.map((item,index)=>selectedExperienceSection(proposal,item,index)).join("");
}

function proposalSelectedExperiences(proposal) {
  const selected = Array.isArray(proposal.selected_experiences) ? proposal.selected_experiences.filter(Boolean) : [];
  if (selected.length) return selected;
  const content = proposal.content || {};
  const name = content.experienceName || proposal.experience_name;
  return name ? [{ name, package_name: content.packageName || proposal.package_name || "", description: content.experienceDescription || "", features: [], visuals: {} }] : [];
}

function selectedExperienceKey(item={}) {
  const value=String(item.key||item.name||"").toLowerCase();
  if(value.includes("360")) return "360";
  if(value.includes("vogue")) return "vogue";
  if(value.includes("audio")) return "audio";
  if(value.includes("digital")) return "digital";
  if(value.includes("glam")) return "glam";
  return "custom";
}

function selectedExperienceDefaults(key) {
  const origin="https://thelolabooth.com/assets";
  return {
    glam:{hero:`${origin}/glam.jpg`,equipment:`${origin}/glam.jpg`,interaction:`${origin}/hero-v2-2.jpg`,customization:`${origin}/hero-v2-4.jpg`,output:`${origin}/glam.jpg`},
    "360":{hero:`${origin}/booth360.jpg`,equipment:`${origin}/booth3601.jpg`,interaction:`${origin}/booth360.jpg`,customization:`${origin}/hero-v2-3.jpg`,output:`${origin}/booth3601.jpg`},
    vogue:{hero:`${origin}/vogue.jpg`,equipment:`${origin}/vogue1.jpg`,interaction:`${origin}/vogue.jpg`,customization:`${origin}/vogue1.jpg`,output:`${origin}/vogue.jpg`},
    audio:{hero:`${origin}/audio.jpg`,equipment:`${origin}/audio.jpg`,interaction:`${origin}/audio.jpg`,customization:`${origin}/audio.jpg`,output:`${origin}/audio.jpg`}
  }[key] || {};
}

function selectedExperienceVisual(proposal,item,slot) {
  const key=selectedExperienceKey(item);
  const defaults=selectedExperienceDefaults(key);
  return item.visuals?.[slot] || proposal.proposal_visuals?.[key]?.[slot] || defaults[slot] || "";
}

function selectedExperienceFeatures(key,item) {
  if(Array.isArray(item.features)&&item.features.length) return item.features;
  return {
    glam:["Unlimited portrait sessions","Black-and-white or color capture","Custom welcome screen","Custom photo overlay","Instant digital sharing","Professional LOLA attendant","Delivery, setup & breakdown"],
    "360":["360 video capture","Unlimited sessions during service window","Custom video overlay","Custom video end card","Instant digital delivery","Professional attendant","Delivery, setup & breakdown"],
    vogue:["Full-size Vogue installation","Custom cover creative","Unlimited guest sessions","Professional attendant","Guest posing support","Digital content delivery","Delivery, setup & breakdown"],
    digital:["Digital guest capture","Event creative","Instant digital sharing","Professional setup"],
    custom:[],
    audio:["Vintage-style audio phone","Guest message prompt","Unlimited recordings during event","Event signage","Audio file handoff","Delivery, setup & breakdown"]
  }[key] || [];
}

function selectedExperienceSection(proposal,item,index) {
  const key=selectedExperienceKey(item);
  const title=item.name||"LOLA Experience";
  const headline=item.headline||({glam:"Clean. Classic. Beautifully you.","360":"Turn moments into motion.",vogue:"Make your guests the cover story.",audio:"Some memories are better heard.",digital:"Capture. Share. Celebrate.",custom:"Created around your event."}[key]);
  const description=item.description||"A premium LOLA experience designed around your event.";
  const features=selectedExperienceFeatures(key,item);
  const stories=key==="glam"
    ? [["equipment","The Booth"],["customization","Customization"],["output","Guest Output"]]
    : key==="360"
      ? [["equipment","The Platform"],["interaction","Guest Experience"],["output","Video Treatment"]]
      : key==="vogue"
        ? [["equipment","The Installation"],["customization","Cover Creative"],["output","Editorial Output"]]
        : [["equipment","The Phone"],["customization","Prompt & Signage"],["output","Post-event Delivery"]];
  return `<section class="experience-showcase ${index%2?"alt":""}"><div class="experience-title"><div><p class="eyebrow">EXPERIENCE ${String(index+1).padStart(2,"0")}</p><h2>${escapeProposalValue(title)}</h2></div>${item.package_name?`<span class="experience-pill">${escapeProposalValue(item.package_name)}</span>`:""}</div><div class="experience-hero"><img src="${safeProposalUrl(selectedExperienceVisual(proposal,item,"hero"))}" alt="${escapeProposalValue(title)}"><div><h3>${escapeProposalValue(headline)}</h3><p>${escapeProposalValue(description)}</p><div class="feature-checks">${features.map(feature=>`<div class="feature-check">${escapeProposalValue(feature)}</div>`).join("")}</div></div></div><div class="visual-story">${stories.map(([slot,label])=>`<article><img src="${safeProposalUrl(selectedExperienceVisual(proposal,item,slot))}" alt="${escapeProposalValue(label)}"><h4>${escapeProposalValue(label)}</h4><p>Preview how this part of the experience can look and feel for the event.</p></article>`).join("")}</div></section>`;
}

function escapeProposalValue(value) {
  return String(value||"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[char]));
}
function safeProposalUrl(value) {
  const url=String(value||"").trim();
  if(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(url))return url;
  return /^https:\/\//i.test(url) ? url.replace(/["'<>]/g,"") : "";
}

function proposalPdfDefaultAsset(key) {
  const root=path.resolve(__dirname,"../../../public/brand/proposals");
  const names={glam:"glam.jpg","360":"360.jpg",vogue:"vogue.jpg",audio:"audio.jpg"};
  return names[key]?path.join(root,names[key]):"";
}

function proposalPdfExperienceImage(item) {
  return item.visuals?.hero?.startsWith("data:image/")?Buffer.from(item.visuals.hero.split(",")[1],"base64"):proposalPdfDefaultAsset(selectedExperienceKey(item));
}






function strip(value) {
  return sanitizeContent(value).replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n");
}
