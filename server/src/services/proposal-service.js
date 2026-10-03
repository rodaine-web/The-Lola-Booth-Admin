import { composeProposal } from "../../../shared/proposal-scenario.js";
import { compactProposalPhotos } from "./proposal-pdf-images.js";
import { secureDocumentUrl } from "../../../shared/document-access.js";
import {validateProposalVisuals,hydrateProposalVisuals} from "./proposal-visual-service.js";
import {proposalCatalogError} from '../../../shared/proposal-catalog.js';
import { documentOrigin } from "../utils/public-document-url.js";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { query, transaction } from "../db/pool.js";
import { AppError, notFound } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { writeAudit } from "./audit-service.js";
import { brandedEmailHtml, recordTemplateFallback, renderCommunicationTemplateByKey } from "./automation-service.js";
import { generateProposalDocx, generateProposalPdf, proposalHtml, storeDocument } from "./document-service.js";
import { sendEmail } from "./email-service.js";
import { getStorageProvider } from "./storage-service.js";

const money = (value) => Number(value || 0);

export async function nextNumber(client, column, prefixColumn, fallbackPrefix) {
  const settings = await client.query(`SELECT id, ${column}, ${prefixColumn} FROM business_settings LIMIT 1 FOR UPDATE`);
  const row = settings.rows[0];
  const table = column === "next_invoice_number" ? "invoices" : "proposals";
  const numberField = column === "next_invoice_number" ? "invoice_number" : "proposal_number";
  const prefix = row[prefixColumn] || fallbackPrefix;
  let next = row[column] || 1001;
  while (true) {
    const candidate = `${prefix}-${next}`;
    const existing = await client.query(`SELECT 1 FROM ${table} WHERE ${numberField}=$1 LIMIT 1`, [candidate]);
    if (!existing.rows[0]) {
      await client.query(`UPDATE business_settings SET ${column}=$1 WHERE id=$2`, [next + 1, row.id]);
      return candidate;
    }
    next += 1;
  }
}

export async function buildProposalSnapshot(input) {
  const visualSections = await validateProposalVisuals(input.visual_sections || []);
  if(input.scenario_enabled && !input.selected_experiences?.length)throw new AppError("Select at least one experience.",422,"EXPERIENCE_REQUIRED");
  if(input.scenario_enabled && (['discount','travel','other_fees','tax_rate','deposit_value'].some(k=>input[k]!=null && (!Number.isFinite(Number(input[k]))||Number(input[k])<0)) || (input.deposit_type!=='FIXED' && Number(input.deposit_value)>100)))throw new AppError("Pricing adjustments must be positive; percentage deposits cannot exceed 100%.",422,"PRICING_INVALID");
  const [settings, client, event, pkg, exp, documentTemplate] = await Promise.all([
    query("SELECT * FROM business_settings LIMIT 1"),
    input.client_id ? query("SELECT * FROM clients WHERE id=$1", [input.client_id]) : { rows: [] },
    input.event_id ? query("SELECT * FROM events WHERE id=$1", [input.event_id]) : { rows: [] },
    input.package_id ? query("SELECT p.*, COALESCE(json_agg(pi.label ORDER BY pi.display_order) FILTER (WHERE pi.id IS NOT NULL),'[]') AS items FROM packages p LEFT JOIN package_items pi ON pi.package_id=p.id WHERE p.id=$1 GROUP BY p.id", [input.package_id]) : { rows: [] },
    input.experience_id ? query("SELECT * FROM experiences WHERE id=$1", [input.experience_id]) : { rows: [] },
    query("SELECT * FROM proposal_document_templates WHERE key=$1 AND active=true", [input.document_template_key || "standard_event_proposal"]).catch(() => ({ rows: [] }))
  ]);
  const s = settings.rows[0] || {};
  const customer = client.rows[0] || {};
  const ev = event.rows[0] || {};
  const pack = pkg.rows[0] || {};
  const experience = exp.rows[0] || {};
  const selectedInput = Array.isArray(input.selected_experiences) ? input.selected_experiences : [];
  if(input.scenario_enabled && (new Set(selectedInput.map(item=>item.experience_id)).size!==selectedInput.length || selectedInput.length>4))throw new AppError("Select each experience once, up to four experiences.",422,"CATALOG_SELECTION_INVALID");
  if(input.scenario_enabled && (input.custom_line_items||[]).some(line=>!String(line.description||'').trim() || !(Number(line.quantity||1)>0) || Number(line.unit_price||0)<0))throw new AppError("Custom line items need a description, positive quantity and a non-negative price.",422,"PRICING_INVALID");
  const selectedIds = selectedInput.map((item) => item?.experience_id).filter(Boolean);
  const selectedPackageIds = selectedInput.flatMap((item) => Array.isArray(item?.packages) ? item.packages.map((pkg) => pkg?.package_id).filter(Boolean) : []);
  const [selectedExperienceRows, selectedPackageRows] = await Promise.all([
    selectedIds.length ? query("SELECT * FROM experiences WHERE id = ANY($1::uuid[])", [selectedIds]).then(result => result.rows) : [],
    selectedPackageIds.length ? query("SELECT p.*, COALESCE(json_agg(pi.label ORDER BY pi.display_order) FILTER (WHERE pi.id IS NOT NULL),'[]') AS items FROM packages p LEFT JOIN package_items pi ON pi.package_id=p.id WHERE p.id = ANY($1::uuid[]) GROUP BY p.id", [selectedPackageIds]).then(result => result.rows) : []
  ]);
  const selectedExperiences = selectedInput.map((item, index) => {
    const catalog = selectedExperienceRows.find((row) => row.id === item.experience_id) || {};
    if(input.scenario_enabled && (!catalog.id || catalog.active===false))throw new AppError("Choose an active catalog experience.",422,"CATALOG_SELECTION_INVALID");
    const packages = (Array.isArray(item.packages) ? item.packages : []).map((selectedPackage) => {
      const packageCatalog = selectedPackageRows.find((row) => row.id === selectedPackage.package_id) || {};
      if (!packageCatalog.id || packageCatalog.active === false || (packageCatalog.experience_id && packageCatalog.experience_id !== item.experience_id)) throw new AppError("Choose an active package belonging to the selected experience.",422,"CATALOG_SELECTION_INVALID");
      if (packageCatalog.pricing_mode === 'CUSTOM' && !(Number(selectedPackage.price)>0)) throw new AppError("Enter the agreed custom package price.",422,"CATALOG_SELECTION_INVALID");
      return {
        duration: packageCatalog.duration, included_hours: packageCatalog.included_hours,
        features: packageCatalog.items?.length ? packageCatalog.items : (packageCatalog.website_features || []),
        package_id: selectedPackage.package_id || packageCatalog.id || null,
        name: selectedPackage.name || packageCatalog.name || "Package",
        price: money(selectedPackage.price ?? packageCatalog.starting_price ?? 0),
        description: selectedPackage.description || packageCatalog.proposal_description || packageCatalog.description || ""
      };
    });
    return {
      experience_id: item.experience_id || catalog.id || null,
      key: item.key || proposalExperienceKey(item.name || catalog.name || `experience-${index + 1}`),
      name: item.name || catalog.name || `Experience ${index + 1}`,
      packages,
      package_name: packages.length ? packages.map((pkg) => pkg.name).join(" + ") : (item.package_name || ""),
      price: packages.length ? packages.reduce((sum, pkg) => sum + pkg.price, 0) : money(item.price ?? item.unit_price ?? catalog.base_price ?? 0),
      headline: item.headline || "",
      description: item.description || catalog.proposal_description || catalog.description || "",
      features: Array.isArray(item.features) ? item.features : [],
      visuals: item.visuals || {}
    };
  });
  const addonIds = (input.addons || []).map((item) => item.addon_id).filter(Boolean);
  const addons = addonIds.length ? await query("SELECT * FROM addons WHERE id = ANY($1::uuid[])", [addonIds]) : { rows: [] };
  const catalogError = proposalCatalogError(selectedExperiences.length ? {...input, package_amount:selectedExperiences.flatMap(item=>item.packages).find(item=>item.package_id===input.package_id)?.price} : input, pack, addons.rows);
  if (catalogError) throw new AppError(catalogError,422,"CATALOG_SELECTION_INVALID");
  const addonRows = input.addons || [];
  const packageAmount = money(input.package_amount ?? pack.starting_price);
  const experienceAmount = money(input.experience_surcharge ?? 0);
  const addonItems = addonRows.map((selected) => {
    const addon = addons.rows.find((item) => item.id === selected.addon_id) || {};
    const qty = money(selected.quantity || 1);
    const unit = money(selected.unit_price ?? addon.price);
    return { type: "ADDON", addon_id: selected.addon_id, description: selected.description || addon.name, quantity: qty, unit_price: unit, line_total: qty * unit, pricing_type: addon.pricing_type || selected.pricing_type };
  });
  const customLines = [...(input.custom_services || []), ...(input.custom_line_items || [])].map((item) => {
    const qty = money(item.quantity || 1);
    const unit = money(item.unit_price || item.rate || 0);
    return {
      type: item.type || "CUSTOM",
      description: item.description || item.label || item.name || "Custom service",
      detail: item.detail || item.notes || item.secondary_description || "",
      quantity: qty,
      unit_price: unit,
      line_total: money(item.line_total ?? qty * unit),
      taxable: item.taxable !== false
    };
  });
  const selectedExperienceLines = selectedExperiences.flatMap((item) => {
    if (item.packages?.length) {
      return item.packages.map((pkg) => ({
        type: "EXPERIENCE_SELECTED",
        experience_id: item.experience_id,
        package_id: pkg.package_id,
        description: [item.name, pkg.name].filter(Boolean).join(" - "),
        detail: pkg.description || item.description || "",
        quantity: 1,
        unit_price: pkg.price,
        line_total: pkg.price
      }));
    }
    return [{
      type: "EXPERIENCE_SELECTED",
      experience_id: item.experience_id,
      description: [item.name, item.package_name].filter(Boolean).join(" - "),
      detail: item.description || "",
      quantity: 1,
      unit_price: item.price,
      line_total: item.price
    }];
  });
  const lines = [
    ...(!selectedExperiences.length && (input.package_id || packageAmount > 0 || pack.name) ? [{ type: "PACKAGE", package_id: input.package_id, description: input.package_name || pack.name || "Package", detail: input.package_description || pack.proposal_description || "", quantity: 1, unit_price: packageAmount, line_total: packageAmount }] : []),
    ...(!selectedExperiences.length && experienceAmount ? [{ type: "EXPERIENCE", experience_id: input.experience_id, description: `${experience.name || "Experience"} surcharge`, quantity: 1, unit_price: experienceAmount, line_total: experienceAmount }] : []),
    ...selectedExperienceLines,
    ...addonItems,
    ...customLines,
    ...(money(input.travel) ? [{ type: "TRAVEL", description: "Travel", quantity: 1, unit_price: money(input.travel), line_total: money(input.travel) }] : []),
    ...(money(input.other_fees) ? [{ type: "OTHER", description: "Other fees", quantity: 1, unit_price: money(input.other_fees), line_total: money(input.other_fees) }] : [])
  ];
  const subtotal = lines.reduce((sum, item) => sum + item.line_total, 0);
  const discount = money(input.discount);
  const taxable = Math.max(0, subtotal - discount);
  const taxRate = money(input.tax_rate ?? s.sales_tax_percent);
  const tax = taxable * (taxRate / 100);
  const total = taxable + tax;
  const depositType = input.deposit_type || "PERCENTAGE";
  const depositValue = money(input.deposit_value ?? s.default_deposit_percent ?? 30);
  const depositAmount = depositType === "FIXED" ? depositValue : total * (depositValue / 100);
  const selectedTemplate = documentTemplate.rows[0] || {};
  const editableSections = buildEditableProposalSections(selectedTemplate.sections || [], {
    client: customer,
    event: ev,
    package: pack,
    experience,
    total,
    depositAmount,
    input,
    settings: s
  });

  const snapshot = {
    visualSections,
    client: customer,
    event: ev,
    package: pack,
    experience,
    content: {
      introduction: input.introduction || s.proposal_default_intro,
      experienceName: input.experience_name || experience.name,
      experienceDescription: input.experience_description || experience.proposal_description || experience.description,
      packageName: input.package_name || pack.name,
      packageDescription: input.package_description || pack.proposal_description || pack.description,
      packageMostPopular: Boolean(pack.most_popular),
      nextSteps: input.next_steps || s.proposal_default_next_steps,
      terms: input.terms || s.proposal_default_terms,
      notes: input.notes || "",
      closing: "Let's make it official.\n\nGood people. Better photos.\n\nTHE LOLA BOOTH"
    },
    documentTemplateKey: selectedTemplate.key || input.document_template_key || "standard_event_proposal",
    proposalTitle: input.proposal_title || input.title || contentTitle(input, pack, experience),
    proposalDate: input.proposal_date || new Date().toISOString().slice(0, 10),
    editableSections,
    lineItems: lines,
    pricing: {
      subtotal: round(subtotal),
      discount: round(discount),
      tax_rate: round(taxRate),
      tax: round(tax),
      total: round(total),
      deposit_type: depositType,
      deposit_value: round(depositValue),
      deposit_amount: round(depositAmount),
      balance: round(total - depositAmount),
      balance_due_date: input.balance_due_date || null
    },
    validThrough: input.valid_through || new Date(Date.now() + Number(s.proposal_default_validity_days || 14) * 86400000).toISOString().slice(0, 10),
    proposalType: input.proposal_type || "PRIVATE_EVENT",
    selectedExperiences,
    proposalVisuals: input.proposal_visuals || {}
  };
  if (input.scenario_enabled) {
    const template = (await query("SELECT config,version FROM proposal_document_templates WHERE key='scenario_composer' AND active=true")).rows[0];
    if (!template) throw new AppError("Apply the proposal scenario migration before creating a composed proposal.",503,"PROPOSAL_TEMPLATE_UNAVAILABLE");
    snapshot.content.scenario = composeProposal({input:{...input,proposal_title:snapshot.proposalTitle,proposal_date:snapshot.proposalDate,valid_through:snapshot.validThrough},client:customer,event:ev,experiences:selectedExperiences,pricing:snapshot.pricing,lines,config:template.config,templateVersion:template.version,settings:s});
    snapshot.content.scenario_overrides = input.scenario_overrides || {};
    const scenario=snapshot.content.scenario;
    for(const item of scenario.experiences) { const slot='experience:'+item.experience_id; if(!scenario.media[slot])scenario.media[slot]=template.config?.experiences?.[item.key]?.media_ids||[]; }
    const mediaSections=['cover','event',...selectedExperiences.map(item=>'experience:'+item.experience_id)].map(slot=>({id:crypto.randomUUID(),title:slot,kind:'REFERENCE',body:'',media_ids:(scenario.media[slot]|| (slot.startsWith('experience:') ? [] : [...scenario.media.event,...scenario.media.global])).slice(0,4)})).filter(section=>section.media_ids.length);
    snapshot.visualSections = await validateProposalVisuals([...visualSections.filter(section=>!(section.kind==='REFERENCE' && /^(cover|event|experience:)/.test(section.title))),...mediaSections]);
    // Freeze approved media together with copy, facts and financials. Later CMS edits cannot change sent documents.
    const hydrated=await compactProposalPhotos(await hydrateProposalVisuals({selected_experiences:selectedExperiences,visual_sections:snapshot.visualSections}));
    scenario.experiences=scenario.experiences.map(item=>{
      const mappedSection=hydrated.visual_sections.find(row=>row.kind==='EXPERIENCE' && row.title===`${item.name} · Experience photos`);
      // Composed documents never trust arbitrary URLs or data supplied as a visual string.
      return {...item,visuals:mappedSection?.images?.length?{hero:mappedSection.images[0].dataUri}: {}};
    });
    scenario.mediaImages=Object.fromEntries(mediaSections.map(section=>[section.title,hydrated.visual_sections.find(row=>row.id===section.id)?.images||[]]));
    snapshot.content.scenario=scenario;
  }
  return snapshot;
}


async function resolveProposalRelationships(input = {}) {
  if (!input.lead_id) return input;
  const lead = (await query(
    `SELECT id, converted_client_id, converted_event_id, preferred_package_id, preferred_experience_id
     FROM leads WHERE id=$1 AND deleted_at IS NULL`,
    [input.lead_id]
  )).rows[0];
  if (!lead) throw notFound("Lead");
  return {
    ...input,
    client_id: input.client_id || lead.converted_client_id || null,
    event_id: input.event_id || lead.converted_event_id || null,
    package_id: input.package_id || lead.preferred_package_id || null,
    experience_id: input.experience_id || lead.preferred_experience_id || null
  };
}

async function ensureProposalLead(client, input = {}, actorUserId = null) {
  if (input.lead_id) return input;
  if (!input.client_id || !input.event_id) {
    throw new AppError(
      "Choose an existing lead, or choose/create both a client and an event before creating the proposal.",
      422,
      "PROPOSAL_RELATIONSHIPS_REQUIRED"
    );
  }

  const [clientResult, eventResult] = await Promise.all([
    client.query("SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL", [input.client_id]),
    client.query("SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL", [input.event_id])
  ]);
  const customer = clientResult.rows[0];
  const event = eventResult.rows[0];
  if (!customer) throw notFound("Client");
  if (!event) throw notFound("Event");

  if (event.client_id && event.client_id !== customer.id) {
    throw new AppError(
      "The selected event belongs to a different client. Choose the matching client or event before creating the proposal.",
      422,
      "PROPOSAL_CLIENT_EVENT_MISMATCH"
    );
  }

  const existing = (await client.query(
    `SELECT id FROM leads
     WHERE deleted_at IS NULL
       AND converted_event_id=$1
     ORDER BY created_at DESC
     LIMIT 1`,
    [event.id]
  )).rows[0];
  if (existing) return { ...input, lead_id: existing.id };

  if (!customer.email) {
    throw new AppError(
      "The selected client needs an email address before a proposal-stage lead can be created.",
      422,
      "CLIENT_EMAIL_REQUIRED"
    );
  }
  const name = String(customer.name || "").trim();
  const pieces = name.split(/\s+/).filter(Boolean);
  const firstName = customer.first_name || pieces[0] || "Client";
  const lastName = customer.last_name || pieces.slice(1).join(" ") || "Contact";
  const inserted = (await client.query(
    `INSERT INTO leads (
       first_name,last_name,email,phone,event_date,event_start_time,event_end_time,event_type,
       guest_count,venue_name,venue_address,city,state,zip,preferred_experience_id,preferred_package_id,
       referral_source,message,lead_source,assigned_user_id,status,converted_client_id,converted_event_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
       'Admin proposal', $17, 'MANUAL', $18, 'PROPOSAL_DRAFT', $19, $20
     ) RETURNING id`,
    [
      firstName,
      lastName,
      customer.email,
      customer.phone,
      event.event_date,
      event.start_time || null,
      event.end_time || null,
      event.event_type,
      event.guest_count || null,
      event.venue_name || null,
      event.venue_address || null,
      event.city || null,
      event.state || null,
      event.zip || null,
      input.experience_id || event.experience_id || null,
      input.package_id || event.package_id || null,
      input.notes || event.client_notes || event.internal_notes || null,
      actorUserId,
      customer.id,
      event.id
    ]
  )).rows[0];

  return { ...input, lead_id: inserted.id };
}

async function syncLeadProposalStage(client, leadId, stage) {
  if (!leadId) return;
  const allowed = stage === "PROPOSAL_SENT"
    ? ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_DRAFT", "FOLLOW_UP"]
    : ["NEW", "CONTACTED", "QUALIFIED", "FOLLOW_UP"];
  await client.query(
    `UPDATE leads
     SET status=$2, updated_at=now()
     WHERE id=$1 AND deleted_at IS NULL AND status = ANY($3::text[])`,
    [leadId, stage, allowed]
  );
}

export async function createProposal(req) {
  const resolvedBody = await resolveProposalRelationships(req.body);
  const result = await transaction(async (client) => {
    const linkedBody = await ensureProposalLead(client, resolvedBody, req.user.id);
    const proposalNumber = linkedBody.proposal_number || await nextNumber(client, "next_proposal_number", "proposal_prefix", "PROP");
    const snapshot=await buildProposalSnapshot({...resolvedBody,proposal_number:proposalNumber});
    const inserted = await client.query(
      `INSERT INTO proposals (proposal_number, lead_id, client_id, event_id, owner_user_id, package_id, experience_id, secure_token, status, notes, total, valid_through, content, pricing_snapshot, line_items_snapshot, document_template_key, editable_sections, proposal_source, proposal_title, proposal_date, proposal_type, selected_experiences, proposal_visuals)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'GENERATED',$18,$19,$20,$21,$22) RETURNING *`,
      [proposalNumber, linkedBody.lead_id || null, linkedBody.client_id || snapshot.client.id || null, linkedBody.event_id || null, req.user.id, linkedBody.package_id || null, linkedBody.experience_id || null, crypto.randomBytes(24).toString("hex"), linkedBody.status || "DRAFT", linkedBody.notes || null, snapshot.pricing.total, snapshot.validThrough, JSON.stringify(snapshot.content), JSON.stringify(snapshot.pricing), JSON.stringify(snapshot.lineItems), snapshot.documentTemplateKey, JSON.stringify(snapshot.editableSections), snapshot.proposalTitle, snapshot.proposalDate, snapshot.proposalType, JSON.stringify(snapshot.selectedExperiences), JSON.stringify(snapshot.proposalVisuals)]
    );
    await syncLeadProposalStage(client, linkedBody.lead_id, "PROPOSAL_DRAFT");
    await client.query('UPDATE proposals SET visual_sections=$2 WHERE id=$1',[inserted.rows[0].id,JSON.stringify(snapshot.visualSections)]);
    inserted.rows[0].visual_sections=snapshot.visualSections;
    await createProposalVersion(client, inserted.rows[0], req.user.id);
    return inserted.rows[0];
  });
  await recordActivity({ actorUserId: req.user.id, entityType: "proposal", entityId: result.id, action: "proposal_created", summary: `Proposal ${result.proposal_number} created` });
  await writeAudit({ req, action: "proposal_created", entity: "proposal", entityId: result.id, after: result });
  return result;
}

export async function createUploadedProposal(req) {
  const body = req.body || {};
  if (!body.pdf_base64) throw new AppError("Uploaded proposal PDF is required.", 422, "PROPOSAL_PDF_REQUIRED");
  const buffer = Buffer.from(String(body.pdf_base64).replace(/^data:application\/pdf;base64,/, ""), "base64");
  if (!buffer.length) throw new AppError("Uploaded proposal PDF is empty.", 422, "PROPOSAL_PDF_EMPTY");
  const stored = await storeDocument({
    buffer,
    filename: safeFilename(body.filename || "external-proposal.pdf"),
    mimeType: "application/pdf"
  });
  const snapshot = await buildProposalSnapshot({ ...body, custom_line_items: body.custom_line_items || [], package_amount: body.total_investment ?? body.package_amount ?? body.total ?? 0 });
  const result = await transaction(async (client) => {
    const proposalNumber = body.proposal_number || await nextNumber(client, "next_proposal_number", "proposal_prefix", "PROP");
    const inserted = await client.query(
      `INSERT INTO proposals (
         proposal_number, lead_id, client_id, event_id, owner_user_id, secure_token, status, notes, total, valid_through,
         content, pricing_snapshot, line_items_snapshot, document_template_key, editable_sections, proposal_source, proposal_title,
         proposal_date, external_document_storage_key, external_document_filename, external_document_mime_type,
         external_document_size_bytes, external_document_uploaded_at, external_document_uploaded_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'UPLOADED',$16,$17,$18,$19,'application/pdf',$20,now(),$5)
       RETURNING *`,
      [proposalNumber, body.lead_id || null, body.client_id || snapshot.client.id || null, body.event_id || null, req.user.id, crypto.randomBytes(24).toString("hex"), body.status || "DRAFT", body.notes || null, snapshot.pricing.total, snapshot.validThrough, JSON.stringify(snapshot.content), JSON.stringify(snapshot.pricing), JSON.stringify(snapshot.lineItems), snapshot.documentTemplateKey, JSON.stringify(snapshot.editableSections), snapshot.proposalTitle, snapshot.proposalDate, stored.storageKey, stored.filename, stored.sizeBytes]
    );
    await client.query('UPDATE proposals SET visual_sections=$2 WHERE id=$1',[inserted.rows[0].id,JSON.stringify(snapshot.visualSections)]);
    inserted.rows[0].visual_sections=snapshot.visualSections;
    await createProposalVersion(client, inserted.rows[0], req.user.id);
    return { ...inserted.rows[0], document: stored };
  });
  await recordActivity({ actorUserId: req.user.id, entityType: "proposal", entityId: result.id, action: "proposal_uploaded", summary: `External proposal ${result.proposal_number} uploaded` });
  await writeAudit({ req, action: "proposal_uploaded", entity: "proposal", entityId: result.id, after: result });
  return result;
}

export async function createProposalVersion(client, proposal, userId) {
  const next = await client.query("SELECT COALESCE(max(version_number),0)+1 AS version FROM proposal_versions WHERE proposal_id=$1", [proposal.id]);
  const result = await client.query(
    `INSERT INTO proposal_versions (proposal_id, version_number, snapshot, created_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [proposal.id, next.rows[0].version, JSON.stringify(proposal), userId]
  );
  return result.rows[0];
}

export async function getProposal(idOrToken, { publicView = false } = {}) {
  const where = publicView ? "p.secure_token=$1" : "p.id=$1";
  const result = await query(
    `SELECT p.*, c.name AS client_name, c.email AS client_email, e.event_name, e.event_type, e.event_date, e.start_time, e.end_time, e.venue_name, e.guest_count,
      pkg.name AS package_name, x.name AS experience_name,
      linked_invoice.id AS linked_invoice_id, linked_invoice.invoice_number AS linked_invoice_number, linked_invoice.status AS linked_invoice_status
     FROM proposals p
     LEFT JOIN clients c ON c.id=p.client_id
     LEFT JOIN events e ON e.id=p.event_id
     LEFT JOIN packages pkg ON pkg.id=p.package_id
     LEFT JOIN experiences x ON x.id=p.experience_id
     LEFT JOIN LATERAL (
       SELECT i.id, i.invoice_number, i.status
       FROM invoices i
       WHERE i.proposal_id=p.id AND i.deleted_at IS NULL AND i.status <> 'VOID'
       ORDER BY i.created_at DESC
       LIMIT 1
     ) linked_invoice ON true
     WHERE ${where} AND p.deleted_at IS NULL`,
    [idOrToken]
  );
  if (!result.rows[0]) throw notFound("Proposal");
  const proposal = result.rows[0];
  if (publicView && proposal.proposal_snapshot && typeof proposal.proposal_snapshot === "object") {
    const snapshot = proposal.proposal_snapshot;
    return {
      ...proposal,
      proposal_type: snapshot.proposal_type ?? proposal.proposal_type,
      selected_experiences: snapshot.selected_experiences ?? proposal.selected_experiences,
      proposal_visuals: snapshot.proposal_visuals ?? proposal.proposal_visuals,
      visual_sections: snapshot.visual_sections ?? proposal.visual_sections,
      content: snapshot.content ?? proposal.content,
      pricing_snapshot: snapshot.pricing_snapshot ?? proposal.pricing_snapshot,
      line_items_snapshot: snapshot.line_items_snapshot ?? proposal.line_items_snapshot,
      proposal_title: snapshot.proposal_title ?? proposal.proposal_title,
      proposal_date: snapshot.proposal_date ?? proposal.proposal_date,
      valid_through: snapshot.valid_through ?? proposal.valid_through
    };
  }
  return proposal;
}

export async function generateAndStoreProposal(proposal, type) {
  const buffer = await proposalPdfBuffer(proposal, type);
  return storeDocument({
    buffer,
    filename: userDocumentFilename("Proposal", proposal.proposal_number, type),
    mimeType: type === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf"
  });
}

export async function proposalPdfBuffer(proposal, type = "pdf") {
  if (type !== "docx" && proposal.proposal_source === "UPLOADED" && proposal.external_document_storage_key) {
    return getStorageProvider().get(proposal.external_document_storage_key);
  }
  const visualProposal = proposal.content?.scenario ? {...proposal,public_url:publicProposalUrl(proposal)} : await hydrateProposalVisuals(proposal);
  return type === "docx" ? generateProposalDocx(visualProposal) : generateProposalPdf(visualProposal);
}

export async function sendProposal(req, proposal) {
  if (!publicProposalUrl(proposal)) throw new AppError("Public access not available. Generate secure access before sending.", 409, "DOCUMENT_ACCESS_UNAVAILABLE");
  const proposalUrl = publicProposalUrl(proposal);
  const mergeData = proposalMergeData(proposal, proposalUrl);
  let rendered = null;
  try {
    rendered = await renderCommunicationTemplateByKey("PROPOSAL_DELIVERY", mergeData) || await renderCommunicationTemplateByKey("proposal_sent", mergeData);
  } catch (error) {
    await recordTemplateFallback({ templateKey: "PROPOSAL_DELIVERY", reason: error.message, relatedEntityType: "proposal", relatedEntityId: proposal.id, metadata: { code: error.code } });
  }
  if (!rendered) await recordTemplateFallback({ templateKey: "PROPOSAL_DELIVERY", reason: "Active template was not found or could not render.", relatedEntityType: "proposal", relatedEntityId: proposal.id });
  const template = rendered?.template || null;
  const subject = req.body.subject || rendered?.subject || `Your LOLA Booths Proposal - ${proposal.event_name || proposal.event_date || proposal.proposal_number}`;
  const body = req.body.body || rendered?.body || `THE LOLA BOOTH\nGood people. Better photos.\n\nHi ${firstName(proposal.client_name)},\n\nIt was great hearing about your event. We've prepared your LOLA Booths proposal based on the details you shared with us.\n\nReview and accept your proposal:\n${proposalUrl}\n\nYou can download a branded PDF copy from the proposal page.\n\nQuestions? Just reply to this email.\n\nYour event. Their favorite memory.\n\nLOLA Booths`;
  const html = brandedEmailHtml(body, {
    firstName: firstName(proposal.client_name),
    kicker: "Your proposal is ready",
    ctaLabel: "View Your Proposal",
    ctaUrl: proposalUrl,
    event: proposalEmailEvent(proposal),
    secondaryCta: {label:"Download PDF",url:`${proposalUrl}?download=pdf`,copyLabel:"Or download your proposal PDF:"}
  });
  const email = await sendEmail({ to: req.body.recipient || proposal.client_email, subject, body, html, attachments: [] });
  await transaction(async (client) => {
    await client.query(
      `UPDATE proposals
       SET status='SENT', sent_at=now(), updated_at=now(),
           proposal_snapshot=jsonb_build_object(
             'proposal_type',proposal_type,
             'selected_experiences',selected_experiences,
             'proposal_visuals',proposal_visuals,
             'visual_sections',visual_sections,
             'content',content,
             'pricing_snapshot',pricing_snapshot,
             'line_items_snapshot',line_items_snapshot,
             'proposal_title',proposal_title,
             'proposal_date',proposal_date,
             'valid_through',valid_through
           )
       WHERE id=$1`,
      [proposal.id]
    );
    await syncLeadProposalStage(client, proposal.lead_id, "PROPOSAL_SENT");
    await client.query(
      `INSERT INTO proposal_deliveries (proposal_id, recipient_email, delivery_method, status, sent_at)
       VALUES ($1,$2,'EMAIL',$3,now())`,
      [proposal.id, req.body.recipient || proposal.client_email, email.status]
    );
    const communication = await client.query(
      `INSERT INTO communications (
         client_id, event_id, proposal_id, type, channel, direction, template_id, template_key, template_version,
         recipient, subject, rendered_subject, message_summary, rendered_body, rendered_html, merge_data, send_mode, status,
         sent_at, provider, provider_message_id, user_id, created_by, sent_by
       ) VALUES ($1,$2,$3,'EMAIL','EMAIL','OUTBOUND',$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,'SEND_NOW','SENT_TO_PROVIDER',now(),$13,$14,$15,$15,$15)
       RETURNING *`,
      [
        proposal.client_id || null,
        proposal.event_id || null,
        proposal.id,
        template?.id || null,
        template?.key || template?.template_key || null,
        template?.version || null,
        req.body.recipient || proposal.client_email,
        subject,
        body.slice(0, 500),
        body,
        html,
        mergeData,
        email.provider,
        email.providerMessageId,
        req.user?.id || null
      ]
    );
    await client.query(
      `INSERT INTO email_messages (communication_id, provider, provider_message_id, to_email, subject, status, body_preview, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [communication.rows[0].id, email.provider, email.providerMessageId, req.body.recipient || proposal.client_email, subject, "SENT_TO_PROVIDER", body.slice(0, 500)]
    );
  });
  return { email, document: doc };
}

export async function proposalPreviewHtml(proposal) {
  return proposalHtml(proposal.content?.scenario ? proposal : await hydrateProposalVisuals(proposal));
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function firstName(name = "there") {
  return name.split(" ")[0] || "there";
}

function contentTitle(input, pack, experience) {
  return input.experience_name || input.package_name || experience.name || pack.name || "Custom Experience Proposal";
}

function safeFilename(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "external-proposal.pdf";
}

export function userDocumentFilename(kind, number, extension = "pdf") {
  return `LOLA-${kind}-${String(number || "document").replace(/[^a-z0-9._-]+/gi, "-")}.${extension}`;
}

export function publicProposalUrl(proposal) {
  return secureDocumentUrl(documentOrigin(), "proposal", proposal);
}

function proposalEmailEvent(proposal) {
  return {
    date: proposal.event_date,
    venue: proposal.venue_name,
    type: proposal.event_type,
    packageName: proposal.package_name || proposal.proposal_title || proposal.content?.experienceName,
    packageLabel: proposal.package_name ? "Package" : "Experience"
  };
}

function buildEditableProposalSections(sectionNames = [], context = {}) {
  if (Array.isArray(context.input?.sections) && context.input.sections.length) {
    return context.input.sections.map((section, index) => ({
      id: section.id || String(section.title || `section-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      title: section.title || `Section ${index + 1}`,
      body: section.body || section.content || "",
      items: Array.isArray(section.items) ? section.items : [],
      display_order: Number(section.display_order ?? index)
    })).sort((a, b) => a.display_order - b.display_order);
  }
  const names = Array.isArray(sectionNames) && sectionNames.length ? sectionNames : [
    "Introduction", "Recommended Experience", "Scope of Services", "Investment", "Payment Schedule", "Next Steps", "Terms", "Acceptance"
  ];
  const clientName = context.client?.name || "your team";
  const eventName = context.event?.event_name || context.event?.event_type || "your event";
  const packageName = context.package?.name || context.experience?.name || "LOLA experience";
  const formattedTotal = `$${Number(context.total || 0).toFixed(2)}`;
  const formattedDeposit = `$${Number(context.depositAmount || 0).toFixed(2)}`;
  const copy = {
    Introduction: `Thank you for inviting LOLA Booths to be part of ${eventName}. This proposal outlines the experience, production details, and investment prepared for ${clientName}.`,
    "Activation Objective": `Create a polished, guest-friendly brand moment that supports ${clientName}'s activation goals and leaves guests with a memorable shareable photo experience.`,
    "Recommended Experience": `We recommend ${packageName} as the best fit for the event goals, guest flow, and production footprint.`,
    "Creative Concept": "A custom creative direction will translate the brand into booth visuals, overlays, backdrop moments, and guest-facing details.",
    "Guest Journey": "Guests are welcomed, guided through a smooth capture experience, and leave with branded content ready to share.",
    "Brand Integration": "Brand elements can be incorporated through overlays, start screens, galleries, signage, print layouts, and supporting production details.",
    "Scope of Services": "LOLA Booths will provide planning, booth operation, setup, breakdown, digital delivery, and coordination with the event team.",
    Deliverables: "Deliverables may include booth coverage, branded captures, online gallery access, attendant support, and selected package inclusions.",
    "Optional Enhancements": "Optional enhancements can be added based on final creative direction, guest count, venue requirements, and brand goals.",
    "Production Requirements": "Final production requirements will be confirmed before event day, including access, power, load-in, footprint, and contact details.",
    Investment: `Estimated investment: ${formattedTotal}. Final pricing remains tied to the selected package, add-ons, taxes, discounts, and approved fees.`,
    "Payment Schedule": `Deposit due to reserve the date: ${formattedDeposit}. Remaining balance follows the invoice/payment schedule selected for this proposal.`,
    "Next Steps": "Review this proposal, request any edits, then accept when ready. Once accepted, LOLA Booths will prepare the invoice and production details.",
    Terms: context.settings?.proposal_default_terms || "Dates are reserved after proposal acceptance and required payment. Final scope is subject to confirmed event details.",
    Acceptance: "Acceptance confirms the selected scope, investment, and next steps for booking."
  };
  return names.map((name, index) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
    title: name,
    body: context.input?.section_bodies?.[name] || copy[name] || "",
    display_order: index
  }));
}

function proposalMergeData(proposal, proposalUrl) {
  const first = firstName(proposal.client_name);
  return {
    client_name: proposal.client_name,
    proposal_number: proposal.proposal_number,
    proposal_url: proposalUrl,
    event_date: proposal.event_date,
    venue: proposal.venue_name,
    client: {
      first_name: first,
      name: proposal.client_name,
      email: proposal.client_email
    },
    event: {
      id: proposal.event_id,
      name: proposal.event_name,
      date: proposal.event_date,
      venue: proposal.venue_name
    },
    proposal: {
      id: proposal.id,
      number: proposal.proposal_number,
      url: proposalUrl,
      public_url: proposalUrl,
      title: proposal.proposal_title,
      package_name: proposal.package_snapshot?.name || proposal.package_name || "",
      total: `$${Number(proposal.total || 0).toFixed(2)}`
    }
  };
}

function proposalExperienceKey(value = "") {
  const normalized = String(value).toLowerCase();
  if (normalized.includes("360")) return "360";
  if (normalized.includes("vogue")) return "vogue";
  if (normalized.includes("audio")) return "audio";
  if (normalized.includes("glam")) return "glam";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "experience";
}
