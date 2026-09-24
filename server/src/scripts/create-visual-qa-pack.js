import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const outputDir = process.env.LOLA_QA_OUTPUT_DIR ? path.resolve(process.env.LOLA_QA_OUTPUT_DIR) : path.join(root, "qa-output");
const screenshotsDir = path.join(outputDir, "screenshots");
const localPublicBase = path.relative(outputDir, path.join(root, "public"));

process.env.PUBLIC_BASE_URL = "https://admin.thelolabooth.com";
process.env.CLIENT_ORIGIN = "https://admin.thelolabooth.com";

const { brandedEmailHtml, renderTemplate } = await import("../services/automation-service.js");
const { generateProposalPdf, generateInvoicePdf } = await import("../services/document-service.js");

const publicBase = "https://admin.thelolabooth.com";
const invoiceToken = "qa-invoice-northstar-2026";
const proposalToken = "qa-proposal-northstar-2026";
const invoiceUrl = `${publicBase}/invoice/${invoiceToken}`;
const proposalUrl = `${publicBase}/proposal/${proposalToken}`;

const sample = {
  client: {
    first_name: "Avery",
    name: "Avery Johnson",
    company: "Northstar Events Group",
    email: "avery.johnson@example.com",
    phone: "312-555-0188"
  },
  event: {
    name: "Northstar Annual Gala",
    type: "Corporate Gala",
    date: "November 21, 2026",
    venue: "The Langham Chicago",
    location: "Chicago, Illinois",
    guest_count: "350"
  },
  proposal: {
    number: "PROP-2026-QA-001",
    url: proposalUrl,
    package_name: "Lola Glam + Brand Activation"
  },
  invoice: {
    number: "INV-2026-QA-001",
    url: invoiceUrl,
    amount_due: "$2,100.00",
    balance_due: "$2,100.00",
    due_date: "December 5, 2026"
  },
  request: {
    notes: "We are planning a polished corporate gala and would like custom branding, instant sharing, and a premium guest experience."
  },
  subject: "Your LOLA Booth Event Experience",
  body: "We're excited to help bring the Northstar Annual Gala to life.\n\nYour event has been designed around a premium LOLA Glam experience with custom branding, instant sharing, and a polished guest experience from arrival to final capture.\n\nWe'll take care of the details so your team can focus on the event."
};

const templateDefinitions = {
  "booking-confirmation": {
    htmlFile: "booking-confirmation.html",
    textFile: "booking-confirmation.txt",
    subject: "Your booking inquiry has been received",
    body: "Thank you for choosing The Lola Booth! We've received your event booking request and our team is already reviewing the details.\n\nWe'll be in touch shortly with availability, package options, and a custom quote.\n\nWe're excited about the opportunity to be part of your special event!",
    options: {
      firstName: sample.client.first_name,
      kicker: "YOUR BOOKING INQUIRY HAS BEEN RECEIVED!",
      event: {
        date: sample.event.date,
        venue: `${sample.event.venue}, ${sample.event.location}`,
        type: sample.event.type,
        packageLabel: "Guest Count",
        packageName: "Approximately 350"
      }
    }
  },
  "contact-confirmation": {
    htmlFile: "contact-confirmation.html",
    textFile: "contact-confirmation.txt",
    subject: "Thank you for reaching out",
    body: "We've received your message and truly appreciate your interest in The Lola Booth. Our team is reviewing your details and we'll be in touch shortly, usually within one business day.\n\nIn the meantime, if your event date is coming up soon or you have any additional information to share, feel free to reply to this email or give us a call.\n\nMessage Summary:\nName: Avery Johnson\nEmail: avery.johnson@example.com\nPhone: 312-555-0188\nEvent Type: Corporate Gala\nEvent Date: November 21, 2026\nVenue: The Langham Chicago, Chicago, Illinois\nMessage: We are planning a polished corporate gala and would like custom branding, instant sharing, and a premium guest experience.",
    options: {
      firstName: sample.client.first_name,
      kicker: "THANK YOU FOR REACHING OUT!",
    }
  },
  "proposal-email": {
    htmlFile: "proposal-email.html",
    textFile: "proposal-email.txt",
    subject: "Your LOLA proposal is ready",
    body: "Thank you for considering The Lola Booth for your upcoming event!\n\nWe've prepared your custom proposal with all the details, including package options, pricing, and next steps. We're excited about the opportunity to be a part of your special day and create unforgettable moments together.",
    options: {
      firstName: sample.client.first_name,
      ctaLabel: "VIEW YOUR PROPOSAL",
      ctaUrl: proposalUrl,
      event: {
        date: sample.event.date,
        venue: `${sample.event.venue}, ${sample.event.location}`,
        type: sample.event.type,
        packageName: sample.proposal.package_name
      }
    }
  },
  "invoice-email": {
    htmlFile: "invoice-email.html",
    textFile: "invoice-email.txt",
    subject: "Your LOLA invoice is ready",
    body: "Thank you for choosing The Lola Booth! Your invoice for the Northstar Annual Gala is now ready for review. You can view the full details, make a secure payment, or contact us if you have any questions.\n\nInvoice Summary:\nInvoice No.: INV-2026-QA-001\nTotal Amount: $3,000.00\nDeposit Paid: $900.00\nBalance Due: $2,100.00",
    options: {
      firstName: sample.client.first_name,
      kicker: "YOUR INVOICE IS READY",
      ctaLabel: "VIEW YOUR INVOICE",
      ctaUrl: invoiceUrl,
      event: {
        date: sample.event.date,
        venue: `${sample.event.venue}, ${sample.event.location}`,
        type: sample.event.type,
        packageName: sample.proposal.package_name
      }
    }
  },
  "generic-email": {
    htmlFile: "generic-email.html",
    textFile: "generic-email.txt",
    subject: sample.subject,
    body: sample.body,
    options: {
      firstName: sample.client.first_name,
      event: {
        date: sample.event.date,
        venue: `${sample.event.venue}, ${sample.event.location}`,
        type: sample.event.type,
        packageName: sample.proposal.package_name
      }
    }
  }
};

const standardProposal = buildProposal({
  proposal_title: "Custom Experience Proposal",
  editable_sections: [
    { title: "Introduction", body: "Thank you for considering The Lola Booth for the Northstar Annual Gala. We are excited to create a polished, modern photo experience." },
    { title: "Event Details", body: "Event Type: Corporate Gala\nEvent Date: November 21, 2026\nVenue: The Langham Chicago\nEstimated Guests: 350" },
    { title: "Proposed Experience", body: "LOLA Glam + Brand Activation brings custom branding, guided guest flow, instant sharing, and elevated keepsakes." },
    { title: "Package Includes", items: ["Lola Glam photo booth", "Professional attendant", "Custom branded overlay", "Premium backdrop", "Instant sharing", "Online gallery", "Setup and breakdown"] },
    { title: "Investment Summary", body: "The total investment is $3,000. A non-refundable retainer secures the event date." },
    { title: "Next Steps", body: "Review, request adjustments, then accept when ready. LOLA will prepare invoice and production details." },
    { title: "Terms", body: "Services are subject to availability, payment schedule, cancellation, and production requirements." }
  ]
});

const corporateProposal = buildProposal({
  proposal_title: "Brand Activation Proposal",
  proposal_number: "PROP-2026-QA-001-CORP",
  editable_sections: [
    { title: "Campaign Objectives", body: "Create an elevated guest capture moment that supports Northstar's gala brand presence and encourages social sharing." },
    { title: "Brand Experience Concept", body: "A refined LOLA Glam installation with Northstar welcome screens, overlays, backdrop styling, and guest engagement." },
    { title: "Guest Journey", body: "Guests are welcomed, guided through capture, and receive instant digital delivery." },
    { title: "Deliverables", items: ["Premium booth activation", "Custom event overlay", "Brand welcome screen", "Instant sharing kiosk", "Curated online gallery", "Post-event recap assets"] },
    { title: "Branding Opportunities", body: "Northstar branding can appear on overlays, screens, gallery surfaces, signage, and print layouts." },
    { title: "Timeline", body: "Asset collection, design proofing, approval, event production, and gallery delivery are scheduled before the event." },
    { title: "Terms", body: "Final access, power, payment schedule, and cancellation terms must be confirmed before activation." }
  ],
  items: [
    ["Lola Glam Brand Activation", 1, 1850, "Premium booth experience with custom branded flow"],
    ["Custom Brand Overlay", 1, 350, "Event-specific digital overlay design"],
    ["Premium Backdrop", 1, 450, "Polished backdrop styling for gala photos"],
    ["Social Sharing Kiosk", 1, 350, "On-site station for instant sharing"],
    ["Analytics / Reporting", 1, 300, "Post-event summary of engagement"],
    ["Additional Event Hour", 2, 250, "Extended activation coverage"]
  ]
});

const invoice = {
  invoice_number: "INV-2026-QA-001",
  issue_date: "2026-11-01",
  due_date: "2026-12-05",
  event_date: "2026-11-21",
  client_name: sample.client.name,
  client_email: sample.client.email,
  client_phone: sample.client.phone,
  event_name: sample.event.name,
  event_type: sample.event.type,
  venue_name: sample.event.venue,
  location: sample.event.location,
  guest_count: sample.event.guest_count,
  package_name: sample.proposal.package_name,
  corporate_billing: {
    company: sample.client.company,
    billing_address: "330 North Wabash Avenue, Chicago, IL 60611"
  },
  secure_token: invoiceToken,
  subtotal: 3150,
  discount: 150,
  tax: 0,
  total: 3000,
  amount_paid: 900,
  balance_due: 2100,
  amount_outstanding: 2100,
  terms: "A 30% non-refundable retainer is required to secure your date. Remaining balance is due 14 days before the event.",
  items: [
    { label: "Lola Glam Experience", detail: "Premium LOLA booth coverage for Northstar Annual Gala", quantity: 1, unit_price: 1850, line_total: 1850 },
    { label: "Custom Brand Overlay", detail: "Northstar-branded photo overlay", quantity: 1, unit_price: 350, line_total: 350 },
    { label: "Premium Backdrop", detail: "Styled gala backdrop", quantity: 1, unit_price: 450, line_total: 450 },
    { label: "Additional Event Hour", detail: "Extended coverage beyond initial package", quantity: 2, unit_price: 250, line_total: 500 }
  ]
};

await fs.mkdir(screenshotsDir, { recursive: true });
await fs.mkdir(screenshotsDir, { recursive: true });

for (const definition of Object.values(templateDefinitions)) {
  const renderedBody = renderTemplate(definition.body, sample);
  const html = brandedEmailHtml(renderedBody, { ...definition.options, assetBaseUrl: localPublicBase });
  const ctaLine = definition.options.ctaUrl ? `\n\n${definition.options.ctaLabel}: ${definition.options.ctaUrl}` : "";
  await fs.writeFile(path.join(outputDir, definition.htmlFile), html);
  await fs.writeFile(path.join(outputDir, definition.textFile), `${definition.subject}\n\n${renderedBody}${ctaLine}\n`);
}

await fs.writeFile(path.join(outputDir, "LOLA-Proposal-Standard-QA.pdf"), await generateProposalPdf(standardProposal));
await fs.writeFile(path.join(outputDir, "LOLA-Proposal-Corporate-QA.pdf"), await generateProposalPdf(corporateProposal));
await fs.writeFile(path.join(outputDir, "LOLA-Invoice-QA.pdf"), await generateInvoicePdf(invoice));

const manifest = {
  generatedAt: new Date().toISOString(),
  invoiceUrl,
  proposalUrl,
  files: [
    ...Object.values(templateDefinitions).flatMap((item) => [item.htmlFile, item.textFile]),
    "LOLA-Proposal-Standard-QA.pdf",
    "LOLA-Proposal-Corporate-QA.pdf",
    "LOLA-Invoice-QA.pdf"
  ]
};
manifest.browserQa = "NOT_RUN";
manifest.pdfScreenshots = "NOT_RUN";
await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
if (process.env.LOLA_SKIP_BROWSER_QA !== "1") {
  await verifyEmailPreviews(Object.values(templateDefinitions));
  manifest.browserQa = "PASSED";
}
if (process.env.LOLA_CAPTURE_SCREENSHOTS === "1") {
  await renderPdfScreenshots();
  manifest.pdfScreenshots = "GENERATED";
  await verifyInvoiceQr();
  manifest.invoiceQr = "PASSED";
}
await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

function buildProposal(overrides = {}) {
  const items = overrides.items || [
    ["Lola Glam Experience", 1, 1850, "Premium booth experience"],
    ["Custom Brand Overlay", 1, 350, "Event-specific digital overlay"],
    ["Premium Backdrop", 1, 450, "Styled gala backdrop"],
    ["Additional Event Hour", 2, 250, "Extended event coverage"]
  ];
  const subtotal = items.reduce((sum, [, quantity, unitPrice]) => sum + quantity * unitPrice, 0);
  const discount = 150;
  const total = subtotal - discount;
  const deposit = 900;
  return {
    proposal_number: overrides.proposal_number || sample.proposal.number,
    proposal_title: overrides.proposal_title || "Custom Experience Proposal",
    proposal_date: "2026-11-01",
    valid_through: "2026-12-01",
    secure_token: proposalToken,
    client_name: sample.client.name,
    event_name: sample.event.name,
    event_type: sample.event.type,
    event_date: "2026-11-21",
    venue_name: sample.event.venue,
    venue_address: sample.event.location,
    guest_count: sample.event.guest_count,
    package_name: sample.proposal.package_name,
    experience_name: "LOLA Glam",
    content: {},
    editable_sections: overrides.editable_sections,
    pricing_snapshot: {
      subtotal,
      discount,
      tax: 0,
      total,
      deposit_amount: deposit,
      balance: total - deposit
    },
    line_items_snapshot: items.map(([description, quantity, unit_price, detail]) => ({
      description,
      quantity,
      unit_price,
      line_total: quantity * unit_price,
      detail
    }))
  };
}

async function verifyEmailPreviews(definitions) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(process.env.LOLA_CHROME_PATH
    ? { executablePath: process.env.LOLA_CHROME_PATH, headless: true }
    : { channel: "chrome", headless: true });
  const results = [];
  try {
    for (const definition of definitions) {
      for (const [label, width] of [["desktop", 1000], ["mobile", 390]]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        await page.goto(pathToFileURL(path.join(outputDir, definition.htmlFile)).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const measured = await page.evaluate(() => ({
          viewport: innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
          heroBackgroundVisible: getComputedStyle(document.querySelector(".hero-strip")).backgroundColor !== "rgba(0, 0, 0, 0)",
          brokenImages: [...document.images].filter(img => !img.complete || !img.naturalWidth).map(img => img.getAttribute("src"))
        }));
        results.push({ file: definition.htmlFile, layout: label, ...measured });
        if (process.env.LOLA_CAPTURE_SCREENSHOTS === "1") {
          await page.screenshot({ path: path.join(screenshotsDir, `${path.basename(definition.htmlFile, ".html")}-${label}.png`), fullPage: true });
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  const report = {
    status: results.some(item => item.overflow || item.brokenImages.length || !item.heroBackgroundVisible) ? "FAILED" : "PASSED",
    checkedAt: new Date().toISOString(),
    scope: "Local Chrome rendering; real inbox delivery/client compatibility requires a separate test.",
    results
  };
  await fs.writeFile(path.join(outputDir, "mobile-overflow-report.json"), JSON.stringify(report, null, 2));
  if (report.status !== "PASSED") throw new Error("Email preview checks failed; see mobile-overflow-report.json.");
}

async function renderPdfScreenshots() {
  const pdftoppm = process.env.PDFTOPPM || "pdftoppm";

  const renders = [
    ["LOLA-Proposal-Standard-QA.pdf", "standard-proposal-page", 2],
    ["LOLA-Proposal-Corporate-QA.pdf", "corporate-proposal-page", 2],
    ["LOLA-Invoice-QA.pdf", "invoice-page", 2]
  ];
  for (const [fileName, prefix] of renders) {
    const info = spawnSync(process.env.PDFINFO || (path.isAbsolute(pdftoppm) ? path.join(path.dirname(pdftoppm), "pdfinfo") : "pdfinfo"), [path.join(outputDir, fileName)], { encoding: "utf8" });
    if (info.status !== 0) throw new Error(`Cannot count PDF pages: ${fileName}`);
    const pages = Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]);
    if (!pages) throw new Error(`No pages found: ${fileName}`);
    manifest.pdfPageCounts ||= {};
    manifest.pdfPageCounts[fileName] = pages;
    const pdfPath = path.join(outputDir, fileName);
    for (let page = 1; page <= pages; page += 1) {
      const outputPrefix = path.join(screenshotsDir, `${prefix}-${page}`);
      const result = spawnSync(pdftoppm, [
        "-png",
        "-r",
        "144",
        "-f",
        String(page),
        "-l",
        String(page),
        "-singlefile",
        pdfPath,
        outputPrefix
      ], { encoding: "utf8" });
      if (result.status !== 0) {
        throw new Error(`PDF screenshot render failed for ${fileName} page ${page}: ${result.stderr || result.stdout}`);
      }
    }
  }
}

async function verifyInvoiceQr() {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const { default: jsQR } = await import("jsqr");
  const page = manifest.pdfPageCounts["LOLA-Invoice-QA.pdf"];
  const source = `screenshots/invoice-page-${page}.png`;
  const image = await loadImage(path.join(outputDir, source));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const decoded = jsQR(pixels.data, canvas.width, canvas.height);
  const report = {
    checkedAt: new Date().toISOString(),
    status: decoded?.data === invoiceUrl ? "PASSED" : "FAILED",
    decodedUrl: decoded?.data,
    expectedUrl: invoiceUrl,
    source,
    scope: "Decoded from a rasterized generated invoice PDF; fixture token is not a live invoice."
  };
  await fs.writeFile(path.join(outputDir, "qr-verification.json"), JSON.stringify(report, null, 2));
  if (report.status !== "PASSED") throw new Error("Invoice PDF QR did not decode to the expected URL.");
}

console.log(`QA visual pack generated in ${outputDir}`);
