import crypto from "crypto";
import { query, transaction } from "../db/pool.js";
import { AppError } from "../utils/errors.js";
import { logAutomationEvent, recordActivity } from "./activity-service.js";
import { triggerAutomations } from "./automation-service.js";

const providerConfig = {
  WEBSITE: { label: "Website", category: "MARKETING", defaultStatus: "CONNECTED" },
  META: { label: "Meta", category: "MARKETING", defaultStatus: "DISCONNECTED" },
  TIKTOK: { label: "TikTok", category: "MARKETING", defaultStatus: "DISCONNECTED" },
  LINKEDIN: { label: "LinkedIn", category: "MARKETING", defaultStatus: "AWAITING_APPROVAL" }
};

const lolaLeadFields = [
  "first_name", "last_name", "email", "phone", "company", "preferred_contact_method",
  "event_type", "event_date", "event_start_time", "venue_name", "city", "state",
  "guest_count", "preferred_experience", "preferred_package", "estimated_budget",
  "campaign", "ad_id", "form_id"
];

function compact(value) {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

export function normalizeEmail(email) {
  return compact(String(email || "").trim().toLowerCase());
}

export function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits || null;
}

function splitName(fullName = "") {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || "New",
    last_name: parts.length > 1 ? parts.slice(1).join(" ") : "Inquiry"
  };
}

function safePayload(payload = {}) {
  const blocked = new Set(["access_token", "refresh_token", "token", "secret", "password", "authorization"]);
  return Object.fromEntries(Object.entries(payload || {}).filter(([key]) => !blocked.has(String(key).toLowerCase())));
}

function mappedValue(payload, mapping, field, fallbacks = []) {
  const providerField = mapping?.[field] || Object.entries(mapping || {}).find(([, localField]) => localField === field)?.[0];
  const keys = [providerField, ...fallbacks].filter(Boolean);
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") return payload[key];
  }
  return null;
}

function buildNormalizedLead({ provider, payload, mapping = {}, sourceSubtype, testMode = false }) {
  const name = mappedValue(payload, mapping, "full_name", ["full_name", "name", "contact_name"]);
  const split = splitName(name);
  const firstName = mappedValue(payload, mapping, "first_name", ["first_name", "firstName"]) || split.first_name;
  const lastName = mappedValue(payload, mapping, "last_name", ["last_name", "lastName"]) || split.last_name;
  const email = normalizeEmail(mappedValue(payload, mapping, "email", ["email", "email_address"]));
  const phone = compact(mappedValue(payload, mapping, "phone", ["phone", "phone_number", "mobile_phone"]));
  const normalizedPhone = normalizePhone(phone);
  return {
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    normalized_email: email,
    normalized_phone: normalizedPhone,
    company: compact(mappedValue(payload, mapping, "company", ["company", "company_name"])),
    preferred_contact_method: compact(mappedValue(payload, mapping, "preferred_contact_method", ["preferred_contact_method"])),
    event_type: compact(mappedValue(payload, mapping, "event_type", ["event_type", "eventType"])) || "Inquiry",
    event_date: compact(mappedValue(payload, mapping, "event_date", ["event_date", "eventDate"])),
    event_start_time: compact(mappedValue(payload, mapping, "start_time", ["start_time", "event_start_time", "eventStartTime"])),
    event_end_time: compact(mappedValue(payload, mapping, "event_end_time", ["event_end_time", "eventEndTime"])),
    venue_name: compact(mappedValue(payload, mapping, "venue", ["venue", "venue_name", "venueName"])),
    venue_address: compact(mappedValue(payload, mapping, "venue_address", ["venue_address", "venueAddress"])),
    city: compact(mappedValue(payload, mapping, "city", ["city"])),
    state: compact(mappedValue(payload, mapping, "state", ["state"])),
    zip: compact(mappedValue(payload, mapping, "zip", ["zip", "postal_code", "postalCode"])),
    guest_count: compact(mappedValue(payload, mapping, "guest_count", ["guest_count", "guestCount"])),
    preferred_experience_id: compact(mappedValue(payload, mapping, "preferred_experience_id", ["preferred_experience_id", "preferredExperienceId"])),
    preferred_package_id: compact(mappedValue(payload, mapping, "preferred_package_id", ["preferred_package_id", "preferredPackageId"])),
    estimated_budget: compact(mappedValue(payload, mapping, "estimated_budget", ["estimated_budget", "budget"])),
    referral_source: compact(mappedValue(payload, mapping, "referral_source", ["referral_source", "referralSource", "how_heard"])),
    message: compact(mappedValue(payload, mapping, "message", ["message", "comments", "notes"])),
    lead_source: provider,
    provider,
    source_subtype: sourceSubtype || compact(payload.source_subtype) || provider,
    campaign: compact(payload.campaign_name || payload.campaign || payload.utm_campaign),
    campaign_id: compact(payload.campaign_id),
    campaign_name: compact(payload.campaign_name),
    ad_set_id: compact(payload.ad_set_id || payload.adgroup_id),
    ad_id: compact(payload.ad_id),
    form_id: compact(payload.form_id),
    form_name: compact(payload.form_name),
    external_lead_id: compact(payload.external_lead_id || payload.lead_id || payload.id),
    provider_account_id: compact(payload.account_id || payload.page_id || payload.organization_id),
    utm_source: compact(payload.utm_source),
    utm_medium: compact(payload.utm_medium),
    utm_campaign: compact(payload.utm_campaign),
    utm_content: compact(payload.utm_content),
    utm_term: compact(payload.utm_term),
    landing_page_url: compact(payload.landing_page_url),
    referrer_url: compact(payload.referrer_url),
    marketing_email_opt_in: Boolean(payload.marketing_email_opt_in),
    consent_status: compact(payload.consent_status),
    consent_reference: compact(payload.consent_reference),
    raw_provider_reference: safePayload({
      provider,
      external_lead_id: compact(payload.external_lead_id || payload.lead_id || payload.id),
      form_id: compact(payload.form_id),
      campaign_id: compact(payload.campaign_id),
      account_id: compact(payload.account_id || payload.page_id || payload.organization_id)
    }),
    source_details: safePayload(payload.source_details || payload),
    received_at: compact(payload.received_at) || new Date().toISOString(),
    status: "NEW",
    test_mode: testMode
  };
}

export function normalizeWebsiteLead(payload = {}) {
  return buildNormalizedLead({
    provider: "WEBSITE",
    payload: {
      ...payload,
      first_name: payload.firstName || payload.first_name,
      last_name: payload.lastName || payload.last_name,
      event_date: payload.eventDate || payload.event_date,
      event_start_time: payload.eventStartTime || payload.event_start_time,
      event_end_time: payload.eventEndTime || payload.event_end_time,
      venue_name: payload.venueName || payload.venue_name,
      venue_address: payload.venueAddress || payload.venue_address,
      zip: payload.zip || payload.postalCode || payload.postal_code,
      guest_count: payload.guestCount || payload.guest_count,
      preferred_experience_id: payload.preferredExperienceId || payload.preferred_experience_id,
      preferred_package_id: payload.preferredPackageId || payload.preferred_package_id,
      referral_source: payload.referralSource || payload.referral_source,
      form_id: payload.form_id || "public-inquiry",
      external_lead_id: payload.external_lead_id || crypto.createHash("sha256").update(JSON.stringify(safePayload(payload))).digest("hex").slice(0, 24),
      source_subtype: "WEBSITE"
    },
    sourceSubtype: "WEBSITE",
    testMode: Boolean(payload.test_mode)
  });
}

export function normalizeMetaLead(payload = {}, mapping = {}) {
  const subtype = String(payload.source_subtype || payload.platform || "").toUpperCase().includes("INSTAGRAM") ? "INSTAGRAM" : "FACEBOOK";
  return buildNormalizedLead({ provider: "META", payload, mapping, sourceSubtype: subtype, testMode: Boolean(payload.test_mode) });
}

export function normalizeTikTokLead(payload = {}, mapping = {}) {
  return buildNormalizedLead({ provider: "TIKTOK", payload, mapping, sourceSubtype: "TIKTOK", testMode: Boolean(payload.test_mode) });
}

export function normalizeLinkedInLead(payload = {}, mapping = {}) {
  return buildNormalizedLead({ provider: "LINKEDIN", payload, mapping, sourceSubtype: "LINKEDIN", testMode: Boolean(payload.test_mode) });
}

async function fieldMapFor(provider, formId) {
  const result = await query(
    `SELECT fm.field_map
     FROM integration_field_maps fm
     JOIN integration_connections ic ON ic.id=fm.integration_connection_id
     WHERE ic.provider=$1 AND fm.local_entity='lead' AND fm.provider_entity=$2
     LIMIT 1`,
    [provider, formId || "default"]
  );
  return result.rows[0]?.field_map || {};
}

async function assignLead(client, normalized) {
  const settings = (await client.query("SELECT lead_assignment_mode, lead_assignment_user_id, lead_assignment_rules FROM business_settings LIMIT 1")).rows[0] || {};
  if (settings.lead_assignment_mode === "SPECIFIC_USER" && settings.lead_assignment_user_id) return settings.lead_assignment_user_id;
  const rules = settings.lead_assignment_rules || {};
  const sourceKey = normalized.source_subtype || normalized.provider || normalized.lead_source;
  if (settings.lead_assignment_mode === "BY_SOURCE" && rules[sourceKey]) return rules[sourceKey];
  if (settings.lead_assignment_mode === "ROUND_ROBIN") {
    const sales = await client.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id=u.id
       JOIN roles r ON r.id=ur.role_id
       WHERE u.active=true AND u.deleted_at IS NULL AND r.name IN ('OWNER','ADMIN','SALES')
       ORDER BY (SELECT count(*) FROM leads l WHERE l.assigned_user_id=u.id), u.created_at
       LIMIT 1`
    );
    return sales.rows[0]?.id || null;
  }
  return null;
}

async function duplicateCheck(client, normalized) {
  if (normalized.provider && normalized.external_lead_id) {
    const replay = await client.query(
      "SELECT id FROM leads WHERE provider=$1 AND external_lead_id=$2 AND deleted_at IS NULL LIMIT 1",
      [normalized.provider, normalized.external_lead_id]
    );
    if (replay.rows[0]) return { type: "IDEMPOTENT_REPLAY", leadId: replay.rows[0].id };
  }
  const duplicates = await client.query(
    `SELECT id FROM leads
     WHERE deleted_at IS NULL AND (
       ($1::text IS NOT NULL AND normalized_email=$1)
       OR ($2::text IS NOT NULL AND normalized_phone=$2)
     )
     ORDER BY created_at DESC LIMIT 1`,
    [normalized.normalized_email, normalized.normalized_phone]
  );
  if (duplicates.rows[0]) return { type: "POSSIBLE_DUPLICATE", leadId: duplicates.rows[0].id };
  return { type: normalized.test_mode ? "TEST" : "UNIQUE", leadId: null };
}

export async function ingestProviderLead({ provider, payload, sourceSubtype, webhookEventId = null, testMode = false }) {
  const normalizedProvider = String(provider || "WEBSITE").toUpperCase();
  const mapping = await fieldMapFor(normalizedProvider, payload.form_id || payload.formId);
  const normalizers = { WEBSITE: normalizeWebsiteLead, META: normalizeMetaLead, TIKTOK: normalizeTikTokLead, LINKEDIN: normalizeLinkedInLead };
  const normalized = normalizers[normalizedProvider]
    ? normalizers[normalizedProvider]({ ...payload, source_subtype: sourceSubtype, test_mode: testMode }, mapping)
    : normalizeWebsiteLead(payload);
  if (!normalized.normalized_email && !normalized.normalized_phone) {
    throw new AppError("Lead requires email or phone for safe identity matching.", 422, "MISSING_LEAD_IDENTITY");
  }

  const result = await transaction(async (client) => {
    const duplicate = await duplicateCheck(client, normalized);
    if (duplicate.type === "IDEMPOTENT_REPLAY") {
      await client.query(
        `INSERT INTO lead_source_events (lead_id, webhook_event_id, provider, source_subtype, form_id, form_name, campaign_id, campaign_name, ad_set_id, ad_id, external_lead_id, status, test_mode, safe_payload, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'IDEMPOTENT_REPLAY',$12,$13,$14)`,
        [duplicate.leadId, webhookEventId, normalized.provider, normalized.source_subtype, normalized.form_id, normalized.form_name, normalized.campaign_id, normalized.campaign_name, normalized.ad_set_id, normalized.ad_id, normalized.external_lead_id, normalized.test_mode, safePayload(payload), normalized.received_at]
      );
      return { action: "IDEMPOTENT_REPLAY", lead: { id: duplicate.leadId }, duplicateOf: duplicate.leadId };
    }

    normalized.assigned_user_id = await assignLead(client, normalized);
    normalized.duplicate_status = duplicate.type;
    normalized.duplicate_of_lead_id = duplicate.leadId;
    const allowed = Object.keys(normalized).filter((key) => normalized[key] !== undefined);
    const inserted = await client.query(
      `INSERT INTO leads (${allowed.join(",")})
       VALUES (${allowed.map((_, index) => `$${index + 1}`).join(",")})
       RETURNING *`,
      allowed.map((key) => normalized[key])
    );
    const lead = inserted.rows[0];
    await client.query(
      `INSERT INTO lead_source_events (lead_id, webhook_event_id, provider, source_subtype, form_id, form_name, campaign_id, campaign_name, ad_set_id, ad_id, external_lead_id, status, test_mode, safe_payload, received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [lead.id, webhookEventId, normalized.provider, normalized.source_subtype, normalized.form_id, normalized.form_name, normalized.campaign_id, normalized.campaign_name, normalized.ad_set_id, normalized.ad_id, normalized.external_lead_id, duplicate.type === "UNIQUE" || duplicate.type === "TEST" ? "CREATED_LEAD" : "POSSIBLE_DUPLICATE", normalized.test_mode, safePayload(payload), normalized.received_at]
    );
    await client.query(
      `INSERT INTO tasks (title, description, due_date, assigned_user_id, lead_id, status, priority)
       VALUES ('Follow up with new lead', $1, current_date + interval '1 day', $2, $3, 'OPEN', $4)`,
      [`Lead received from ${friendlySource(normalized)}.${duplicate.leadId ? " Possible existing contact." : ""}`, normalized.assigned_user_id, lead.id, duplicate.leadId ? "HIGH" : "NORMAL"]
    );
    await client.query(
      `UPDATE integration_connections
       SET leads_received_count=leads_received_count+1, last_successful_lead_at=now(), last_successful_sync_at=now(), updated_at=now()
       WHERE provider=$1`,
      [normalizedProvider]
    );
    return { action: duplicate.type === "UNIQUE" || duplicate.type === "TEST" ? "CREATED_LEAD" : "POSSIBLE_DUPLICATE", lead, duplicateOf: duplicate.leadId };
  });

  if (result.lead?.id) {
    await recordActivity({
      entityType: "lead",
      entityId: result.lead.id,
      action: "lead_received",
      summary: `Lead received from ${friendlySource(result.lead)}`,
      metadata: { provider: normalized.provider, source_subtype: normalized.source_subtype, form_id: normalized.form_id, campaign: normalized.campaign }
    });
    await logAutomationEvent({ triggerKey: "LEAD_CREATED", entityType: "lead", entityId: result.lead.id, payload: { source: normalized.provider, source_subtype: normalized.source_subtype } });
    await triggerAutomations({ triggerKey: "LEAD_CREATED", entityType: "lead", entityId: result.lead.id, payload: { source: normalized.provider, source_subtype: normalized.source_subtype } });
  }
  return result;
}

export async function persistWebhookEvent({ provider, eventType, providerEventId, payload }) {
  const externalId = providerEventId || payload?.event_id || payload?.id || crypto.randomUUID();
  const result = await query(
    `INSERT INTO webhook_events (provider, event_type, external_event_id, provider_event_id, payload, status, received_at)
     VALUES ($1,$2,$3,$3,$4,'RECEIVED',now())
     ON CONFLICT (provider, external_event_id) DO UPDATE
     SET attempt_count=webhook_events.attempt_count+1, received_at=now()
     RETURNING *`,
    [provider, eventType, externalId, safePayload(payload)]
  ).catch(async () => {
    const fallback = await query(
      `INSERT INTO webhook_events (provider, event_type, external_event_id, provider_event_id, payload, status, received_at)
       VALUES ($1,$2,$3,$3,$4,'RECEIVED',now())
       ON CONFLICT DO NOTHING RETURNING *`,
      [provider, eventType, externalId, safePayload(payload)]
    );
    return fallback.rows[0] ? fallback : query("SELECT * FROM webhook_events WHERE provider=$1 AND external_event_id=$2 LIMIT 1", [provider, externalId]);
  });
  await query("UPDATE integration_connections SET last_webhook_at=now(), updated_at=now() WHERE provider=$1", [provider]);
  return result.rows[0];
}

export async function processProviderWebhook({ provider, payload, headers = {} }) {
  const normalizedProvider = String(provider).toUpperCase();
  const event = await persistWebhookEvent({
    provider: normalizedProvider,
    eventType: payload.event_type || payload.object || "lead",
    providerEventId: payload.event_id || payload.provider_event_id || payload.id,
    payload
  });
  try {
    await query("UPDATE webhook_events SET status='PROCESSING', attempt_count=attempt_count+1 WHERE id=$1", [event.id]);
    if (normalizedProvider === "LINKEDIN") {
      const connection = await providerConnection("LINKEDIN");
      if (connection.status === "AWAITING_APPROVAL") throw new AppError("LinkedIn Lead Sync requires LinkedIn API approval.", 409, "LINKEDIN_AWAITING_APPROVAL");
    }
    const result = await ingestProviderLead({ provider: normalizedProvider, payload, webhookEventId: event.id, sourceSubtype: payload.source_subtype, testMode: Boolean(payload.test_mode) });
    await query("UPDATE webhook_events SET status='PROCESSED', processed_at=now(), last_error=NULL WHERE id=$1", [event.id]);
    return { ok: true, webhookEventId: event.id, ...result };
  } catch (error) {
    const status = event.attempt_count >= 3 ? "FAILED_NEEDS_REVIEW" : "FAILED";
    await query("UPDATE webhook_events SET status=$1, last_error=$2, error_message=$2 WHERE id=$3", [status, error.message, event.id]);
    await query("UPDATE integration_connections SET status=CASE WHEN status='CONNECTED' THEN 'ERROR' ELSE status END, last_error=$1, updated_at=now() WHERE provider=$2", [error.message, normalizedProvider]);
    if (status === "FAILED_NEEDS_REVIEW") {
      await query(
        `INSERT INTO lead_source_events (webhook_event_id, provider, status, safe_payload)
         VALUES ($1,$2,'FAILED_NEEDS_REVIEW',$3)`,
        [event.id, normalizedProvider, safePayload(payload)]
      );
    }
    throw error;
  }
}

export async function providerConnection(provider) {
  const result = await query(
    `SELECT id, category, provider, status, connected_account, provider_account_id, api_version, scopes,
      selected_forms, metadata, leads_received_count, last_successful_lead_at, last_webhook_at,
      last_successful_sync_at, last_error, verified_at, created_at, updated_at
     FROM integration_connections
     WHERE provider=$1 AND deleted_at IS NULL LIMIT 1`,
    [String(provider).toUpperCase()]
  );
  return result.rows[0] || null;
}

export async function integrationOverview() {
  const connections = await query(
    `SELECT id, category, provider, status, connected_account, provider_account_id, api_version, scopes,
      selected_forms, metadata, leads_received_count, last_successful_lead_at, last_webhook_at,
      last_successful_sync_at, last_error, verified_at, updated_at
     FROM integration_connections
     WHERE deleted_at IS NULL
     ORDER BY category, provider`
  );
  const maps = await query(
    `SELECT fm.*, ic.provider
     FROM integration_field_maps fm
     JOIN integration_connections ic ON ic.id=fm.integration_connection_id
     ORDER BY ic.provider, fm.provider_entity`
  );
  const failed = await failedInboundLeads();
  return {
    leadSources: Object.keys(providerConfig).map((provider) => ({
      ...providerConfig[provider],
      ...(connections.rows.find((row) => row.provider === provider) || { provider, status: providerConfig[provider].defaultStatus }),
      fieldMaps: maps.rows.filter((row) => row.provider === provider)
    })),
    communications: connections.rows.filter((row) => row.category === "EMAIL"),
    failedInbound: failed.data
  };
}

export async function saveFieldMap({ provider, providerEntity = "default", fieldMap }) {
  const connection = await providerConnection(provider);
  if (!connection) throw new AppError("Integration connection is not configured.", 404, "INTEGRATION_NOT_FOUND");
  validateFieldMap(fieldMap);
  const result = await query(
    `INSERT INTO integration_field_maps (integration_connection_id, local_entity, provider_entity, field_map)
     VALUES ($1,'lead',$2,$3)
     ON CONFLICT (integration_connection_id, local_entity, provider_entity)
     DO UPDATE SET field_map=EXCLUDED.field_map, updated_at=now()
     RETURNING *`,
    [connection.id, providerEntity, fieldMap]
  );
  return result.rows[0];
}

export function validateFieldMap(fieldMap = {}) {
  const values = Object.keys(fieldMap);
  const hasIdentity = values.includes("email") || values.includes("phone") || Object.values(fieldMap).includes("email") || Object.values(fieldMap).includes("phone");
  if (!hasIdentity) throw new AppError("Mapping must include email or phone.", 422, "MISSING_IDENTITY_MAPPING");
  return { ok: true, warning: values.includes("event_date") ? null : "No event date mapping configured." };
}

export async function updateIntegrationState({ provider, patch }) {
  const allowed = ["status", "connected_account", "provider_account_id", "api_version", "scopes", "selected_forms", "metadata"];
  const clean = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  if (clean.status === "CONNECTED" && !patch.verified) {
    throw new AppError("Provider verification is required before marking an integration connected.", 422, "VERIFICATION_REQUIRED");
  }
  if (clean.status === "CONNECTED") clean.verified_at = new Date();
  const fields = Object.keys(clean);
  if (!fields.length) throw new AppError("No supported integration fields supplied.", 400, "NO_FIELDS");
  const values = fields.map((field) => clean[field]);
  values.push(String(provider).toUpperCase());
  const result = await query(
    `UPDATE integration_connections SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_at=now()
     WHERE provider=$${values.length} RETURNING id, category, provider, status, connected_account, provider_account_id, api_version, scopes, selected_forms, metadata, leads_received_count, last_successful_lead_at, last_webhook_at, last_error, verified_at`,
    values
  );
  return result.rows[0];
}

export async function failedInboundLeads() {
  const result = await query(
    `SELECT we.id, we.provider, we.event_type, we.provider_event_id, we.status, we.attempt_count, we.last_error, we.received_at, we.processed_at
     FROM webhook_events we
     WHERE we.status IN ('FAILED','FAILED_NEEDS_REVIEW')
     ORDER BY we.received_at DESC LIMIT 50`
  );
  return { data: result.rows };
}

export async function retryInboundLead(id) {
  const event = (await query("SELECT * FROM webhook_events WHERE id=$1", [id])).rows[0];
  if (!event) throw new AppError("Inbound event was not found.", 404, "WEBHOOK_NOT_FOUND");
  return processProviderWebhook({ provider: event.provider, payload: event.payload || {} });
}

export async function resolveInboundLead(id) {
  const result = await query("UPDATE webhook_events SET status='RESOLVED', processed_at=now() WHERE id=$1 RETURNING *", [id]);
  return result.rows[0];
}

export async function sourceQualityAnalytics() {
  const source = await query(
    `SELECT COALESCE(source_subtype, lead_source, 'Other') AS source,
      count(*)::int AS leads,
      count(*) FILTER (WHERE l.status IN ('QUALIFIED','PROPOSAL_DRAFT','PROPOSAL_SENT','WON'))::int AS qualified,
      count(DISTINCT p.id)::int AS proposals_sent,
      count(DISTINCT p.id) FILTER (WHERE p.status='ACCEPTED')::int AS accepted,
      count(*) FILTER (WHERE l.status='WON')::int AS bookings,
      COALESCE(sum(b.total),0)::numeric AS booked_revenue,
      COALESCE(sum(b.amount_paid),0)::numeric AS collected_revenue
     FROM leads l
     LEFT JOIN proposals p ON p.lead_id=l.id AND p.deleted_at IS NULL
     LEFT JOIN bookings b ON b.lead_id=l.id AND b.deleted_at IS NULL
     WHERE l.deleted_at IS NULL AND l.test_mode=false
     GROUP BY 1 ORDER BY leads DESC`
  );
  const campaigns = await query(
    `SELECT COALESCE(campaign_name, campaign, utm_campaign, 'Unattributed') AS campaign,
      COALESCE(source_subtype, lead_source, 'Other') AS source,
      count(*)::int AS leads,
      count(*) FILTER (WHERE l.status='WON')::int AS bookings,
      COALESCE(sum(b.total),0)::numeric AS booked_revenue
     FROM leads l
     LEFT JOIN bookings b ON b.lead_id=l.id AND b.deleted_at IS NULL
     WHERE l.deleted_at IS NULL AND l.test_mode=false
     GROUP BY 1,2 ORDER BY leads DESC LIMIT 25`
  );
  return {
    sourceQuality: source.rows.map((row) => ({
      ...row,
      booked_revenue: Number(row.booked_revenue || 0),
      collected_revenue: Number(row.collected_revenue || 0),
      conversion_rate: Number(row.leads) ? (Number(row.bookings) / Number(row.leads)) * 100 : 0,
      average_booking_value: Number(row.bookings) ? Number(row.booked_revenue || 0) / Number(row.bookings) : 0
    })),
    campaignPerformance: campaigns.rows.map((row) => ({ ...row, booked_revenue: Number(row.booked_revenue || 0) }))
  };
}

export function friendlySource(lead) {
  if (lead.source_subtype === "INSTAGRAM") return "Instagram";
  if (lead.source_subtype === "FACEBOOK") return "Facebook";
  if (lead.provider === "TIKTOK") return "TikTok";
  if (lead.provider === "LINKEDIN") return "LinkedIn";
  if (lead.provider === "WEBSITE" || lead.lead_source === "WEBSITE") return "Website";
  return lead.provider || lead.lead_source || "Manual";
}

export { lolaLeadFields };
