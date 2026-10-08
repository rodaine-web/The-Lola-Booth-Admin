import { creativeAccess, creativeResponseError, publicCreativeView } from "../../../shared/creative-approval-policy.js";
import { writeAudit } from "./audit-service.js";
import { createNotification } from "./notification-service.js";
import { env } from "../config/env.js";
import { userCanAccessEvent } from "./event-operations-service.js";
import { query, transaction } from "../db/pool.js";
import { AppError } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { createCommunicationDraft } from "./automation-service.js";
import {CREATIVE_COMPONENTS} from '../../../shared/event-planning.js';

async function validateProof(input, user, existing = {}) {
  const eventId = existing.event_id || input.event_id;
  if (!eventId || !await userCanAccessEvent(user,eventId)) throw new AppError("You do not have access to this event.",403,"FORBIDDEN");
  const event = (await query("SELECT client_id FROM events WHERE id=$1 AND deleted_at IS NULL",[eventId])).rows[0];
  if (!event || (input.client_id && input.client_id !== event.client_id) || (existing.client_id && existing.client_id !== event.client_id)) throw new AppError("The proof must belong to the event client.",422,"APPROVAL_OWNER_MISMATCH");
  const components=input.metadata?.components;
  if(components!==undefined){
    if(!Array.isArray(components)||components.length>40)throw new AppError('Choose valid creative components.',422,'CREATIVE_COMPONENT_INVALID');
    const experiences=(await query('SELECT experience_id AS id FROM event_experiences WHERE event_id=$1 UNION SELECT experience_id AS id FROM events WHERE id=$1 AND experience_id IS NOT NULL',[eventId])).rows;
    if(components.some(item=>!item||!CREATIVE_COMPONENTS.includes(item.component)||!experiences.some(x=>x.id===item.experienceId)))throw new AppError('Creative components must belong to selected event experiences.',422,'CREATIVE_COMPONENT_INVALID');
    if(existing.id && JSON.stringify(components)!==JSON.stringify(existing.metadata?.components||[]))throw new AppError('Keep component scope unchanged when revising a proof. Create a separate creative item for a different scope.',422,'CREATIVE_COMPONENT_SCOPE_LOCKED');
  }
  const fileId = input.proof_document_id || (input.proof_url ? null : existing.proof_document_id);
  if (fileId) {
    const file = (await query("SELECT id FROM files WHERE id=$1 AND event_id=$2 AND client_id=$3 AND deleted_at IS NULL AND mime_type IN ('image/png','image/jpeg','application/pdf')",[fileId,eventId,event.client_id])).rows[0];
    if (!file) throw new AppError("Choose a PNG, JPG or PDF belonging to this event.",422,"APPROVAL_FILE_SCOPE");
  }
  const proofUrl = input.proof_url || (input.proof_document_id ? null : existing.proof_url);
  if (proofUrl) {
    let url; try { url = new URL(proofUrl); } catch { /* rejected below */ }
    if (!url || url.protocol !== 'https:' || url.username || url.password) throw new AppError("Proof links must use HTTPS.",422,"APPROVAL_URL_INVALID");
  }
  if (!fileId && !proofUrl) throw new AppError("Choose a proof file or HTTPS proof link.",422,"APPROVAL_PROOF_REQUIRED");
  return event.client_id;
}

function snapshot(input = {}) {
  return {
    approvalType: input.approval_type || input.approvalType,
    proofUrl: input.proof_document_id ? null : input.proof_url || input.proofUrl,
    proofDocumentId: input.proof_document_id || null,
    version: input.version || 1,
    metadata: input.metadata || {},
    capturedAt: new Date().toISOString()
  };
}

export async function listCreativeApprovals(filters = {}, user = null) {
  const values = [];
  const clauses = ["ca.deleted_at IS NULL"];
  if (filters.event_id) {
    values.push(filters.event_id);
    clauses.push(`ca.event_id=$${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`ca.status=$${values.length}`);
  }
  const result = await query(
    `SELECT ca.*, c.name AS client_name, e.event_name
     FROM creative_approvals ca
     LEFT JOIN clients c ON c.id=ca.client_id
     LEFT JOIN events e ON e.id=ca.event_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ca.updated_at DESC, ca.requested_at DESC, ca.id DESC
     LIMIT 100`,
    values
  );
  const data = [];
  for (const row of result.rows) if (!user || (row.event_id && await userCanAccessEvent(user,row.event_id))) data.push(user?Object.fromEntries(Object.entries(row).filter(([key])=>key!=="public_token")):row);
  return { data };
}

export async function createCreativeApproval(input = {}, user = {}) {
  return transaction(async () => {
  const clientId = await validateProof(input,user);
  const result = await query(
    `INSERT INTO creative_approvals (
       event_id, client_id, approval_type, status, proof_document_id, proof_url, version,
       expires_at, revision_notes, metadata, approval_snapshot, created_by
     ) VALUES ($1,$2,$3,'DRAFT',$4,$5,1,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      input.event_id || null,
      clientId,
      input.approval_type || "DESIGN",
      input.proof_document_id || null,
      input.proof_url || null,
      input.expires_at || new Date(Date.now() + 30 * 86400000).toISOString(),
      input.revision_notes || null,
      input.metadata || {},
      snapshot(input),
      user.id || null
    ]
  );
  await query(
    `INSERT INTO creative_approval_revisions (approval_id, version, proof_document_id, proof_url, status, notes, snapshot, created_by)
     VALUES ($1,1,$2,$3,'DRAFT',$4,$5,$6)
     ON CONFLICT (approval_id, version) DO NOTHING`,
    [result.rows[0].id, input.proof_document_id || null, input.proof_url || null, input.revision_notes || null, result.rows[0].approval_snapshot, user.id || null]
  );
  await recordActivity({ actorUserId: user.id, entityType: "event", entityId: input.event_id, action: "approval_created", summary: "Creative approval draft created" });
  return result.rows[0];
  });
}

export async function getCreativeApproval(id, user = null) {
  const approval = (await query("SELECT * FROM creative_approvals WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
  if (!approval) throw new AppError("Approval not found.", 404, "APPROVAL_NOT_FOUND");
  if (user && (!approval.event_id || !await userCanAccessEvent(user,approval.event_id))) throw new AppError("You do not have access to this event.",403,"FORBIDDEN");
  const revisions = await query("SELECT * FROM creative_approval_revisions WHERE approval_id=$1 ORDER BY version DESC", [id]);
  return { approval:user?Object.fromEntries(Object.entries(approval).filter(([key])=>key!=="public_token")):approval, revisions: revisions.rows };
}

export async function createApprovalRevision(id, input = {}, user = {}) {
  return transaction(async (client) => {
    const approval = (await client.query("SELECT * FROM creative_approvals WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id])).rows[0];
    if (!approval) throw new AppError("Approval not found.", 404, "APPROVAL_NOT_FOUND");
    await validateProof(input,user,approval);
    if (!input.proof_document_id && !input.proof_url) throw new AppError("Upload or select the new proof before creating a revision.",422,"APPROVAL_PROOF_REQUIRED");
    const nextVersion = Number(approval.version || 1) + 1;
    await query("UPDATE event_planning SET status='CREATIVE_IN_PROGRESS',updated_at=now() WHERE event_id=$1 AND submitted_at IS NOT NULL",[approval.event_id]);
    const approvalSnapshot = snapshot({ ...approval, ...input, version: nextVersion });
    const updated = await client.query(
      `UPDATE creative_approvals
       SET version=$1, status='DRAFT', proof_document_id=$2, proof_url=$3, revision_notes=$4,
           approval_snapshot=$5, approved_by_name=NULL, approved_by_email=NULL, response_notes=NULL, responded_at=NULL, viewed_at=NULL, communication_id=NULL, updated_at=now()
       WHERE id=$6 RETURNING *`,
      [nextVersion, input.proof_document_id || (input.proof_url ? null : approval.proof_document_id), input.proof_url || (input.proof_document_id ? null : approval.proof_url), input.revision_notes || null, approvalSnapshot, id]
    );
    await client.query(
      `INSERT INTO creative_approval_revisions (approval_id, version, proof_document_id, proof_url, status, notes, snapshot, created_by)
       VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7)`,
      [id, nextVersion, input.proof_document_id || (input.proof_url ? null : approval.proof_document_id), input.proof_url || (input.proof_document_id ? null : approval.proof_url), input.revision_notes || null, approvalSnapshot, user.id || null]
    );
    await recordActivity({ actorUserId: user.id, entityType: "event", entityId: approval.event_id, action: "approval_revision_created", summary: `Creative approval version ${nextVersion} created` });
    return updated.rows[0];
  });
}

export async function sendCreativeApprovalRequest(id, user = {}, req = null) {
  return transaction(async () => {
  await query("SELECT id FROM creative_approvals WHERE id=$1 FOR UPDATE",[id]);
  const detail = await getCreativeApproval(id);
  const approval = detail.approval;
  if (!await userCanAccessEvent(user, approval.event_id)) throw new AppError("You do not have access to this event.",403,"FORBIDDEN");
  if (["APPROVED","REVOKED","CANCELLED","SUPERSEDED","CHANGES_REQUESTED"].includes(approval.status)) throw new AppError("This proof cannot be sent for approval.",409,"APPROVAL_LOCKED");
  if (approval.communication_id && ["PENDING_APPROVAL","VIEWED"].includes(approval.status)) return {approval,replayed:true};
  const client = (await query("SELECT name,email FROM clients WHERE id=$1 AND deleted_at IS NULL",[approval.client_id])).rows[0];
  if (!client?.email) throw new AppError("The event client needs an email before sending a proof.",422,"CLIENT_EMAIL_REQUIRED");
  const url = `${env.clientOrigin.replace(/\/$/, "")}/approvals/${approval.public_token}`;
  await query("UPDATE creative_approvals SET status='PENDING_APPROVAL', expires_at=CASE WHEN expires_at IS NULL OR expires_at<=now() THEN now()+interval '30 days' ELSE expires_at END, requested_at=now(), updated_at=now() WHERE id=$1", [id]);
  const draft = await createCommunicationDraft({
    client_id: approval.client_id,
    event_id: approval.event_id,
    template_key: "creative_proof_ready",
    merge_data: {
      approval: { url, version: approval.version, status: "PENDING_APPROVAL" },
      client: { first_name: client.name?.split(" ")[0] || "there", name: client.name || "Client" }
    },
    recipient: client.email,
    send_mode: "SCHEDULED",
    status: "SCHEDULED",
    scheduled_at: new Date().toISOString(),
    trigger_key: "APPROVAL_REQUESTED"
  }, user);
  await query("UPDATE creative_approvals SET communication_id=$1 WHERE id=$2",[draft.id,id]);
  await recordActivity({ actorUserId: user.id, entityType: "event", entityId: approval.event_id, action: "approval_requested", summary: `Creative approval version ${approval.version} requested` });
  return { approval: { ...approval, status: "PENDING_APPROVAL" }, communication: draft };
  });
}

export async function publicCreativeApproval(token) {
  return transaction(async () => {
    const approval = (await query("SELECT a.* FROM creative_approvals a JOIN events e ON e.id=a.event_id JOIN clients c ON c.id=a.client_id AND c.id=e.client_id WHERE a.public_token=$1 AND a.deleted_at IS NULL AND e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') FOR UPDATE OF a", [token])).rows[0];
    if (!creativeAccess(approval)) throw new AppError("This design link is unavailable or expired.",404,"APPROVAL_ACCESS_UNAVAILABLE");
    if (approval.status === "PENDING_APPROVAL") {
      await query("UPDATE creative_approvals SET status='VIEWED', viewed_at=COALESCE(viewed_at, now()), updated_at=now() WHERE id=$1", [approval.id]);
      await recordActivity({ entityType: "event", entityId: approval.event_id, action: "approval_viewed", summary: `Creative approval version ${approval.version} viewed` });
      approval.status = "VIEWED";
    }
    return { approval: publicCreativeView(approval) };
  });
}

export async function respondToCreativeApproval(token, input = {}, req = {headers:{}}) {
  return transaction(async () => {
    const approval = (await query("SELECT a.* FROM creative_approvals a JOIN events e ON e.id=a.event_id JOIN clients c ON c.id=a.client_id AND c.id=e.client_id WHERE a.public_token=$1 AND a.deleted_at IS NULL AND e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') FOR UPDATE OF a", [token])).rows[0];
    const error = creativeResponseError(approval, input);
    if (error) throw new AppError(error === 'APPROVAL_VERSION_CHANGED' ? "The design has changed. Refresh and review the latest version." : "This response cannot be accepted. Check the design, your details and change comments.", error === 'APPROVAL_ACCESS_UNAVAILABLE' ? 404 : 409, error);
    const client = (await query("SELECT email FROM clients WHERE id=$1 AND deleted_at IS NULL", [approval.client_id])).rows[0];
    if (!client?.email || client.email.toLowerCase() !== input.email.trim().toLowerCase()) throw new AppError("Use the email associated with this event.",403,"APPROVAL_IDENTITY_REQUIRED");
    if (approval.status === "APPROVED") return { approval: publicCreativeView(approval), replayed: true };
    const status = input.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
    const response = {status, name:input.name.trim(), email:input.email.trim().toLowerCase(), notes:input.notes || null, version:input.version, respondedAt:new Date().toISOString()};
    const updated = (await query(`UPDATE creative_approvals SET status=$1, approved_version=CASE WHEN $1='APPROVED' THEN version ELSE approved_version END,
      approved_by_name=$2, approved_by_email=$3, response_notes=$4, responded_at=now(),
      approval_snapshot=approval_snapshot || $5::jsonb, updated_at=now() WHERE id=$6 RETURNING *`,
      [status,response.name,response.email,response.notes,JSON.stringify({response}),approval.id])).rows[0];
    await query("UPDATE creative_approval_revisions SET status=$1, snapshot=snapshot || $2::jsonb WHERE approval_id=$3 AND version=$4",[status,JSON.stringify({response}),approval.id,input.version]);
    const action = status === "APPROVED" ? "approval_approved" : "approval_changes_requested";
    await recordActivity({entityType:"event",entityId:approval.event_id,action,summary:`Creative version ${input.version}: ${status}`,metadata:{approvalId:approval.id,version:input.version}});
    await writeAudit({req,action,entity:"creative_approval",entityId:approval.id,after:{status,version:input.version,clientId:approval.client_id}});
    await query("UPDATE event_planning SET status=$1,updated_at=now() WHERE event_id=$2 AND submitted_at IS NOT NULL",[status==='APPROVED'?'CLIENT_REVIEW':'CHANGES_REQUESTED',approval.event_id]);
    if(status==='APPROVED')await query("UPDATE event_planning SET status='APPROVED',updated_at=now() WHERE event_id=$1 AND submitted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM creative_approvals WHERE event_id=$1 AND deleted_at IS NULL AND status NOT IN ('APPROVED','REVOKED','CANCELLED','SUPERSEDED'))",[approval.event_id]);
    await createNotification({roleTarget:"EVENT_MANAGER",category:"EVENTS",title:status==="APPROVED"?"Creative approved":"Creative changes requested",body:`Version ${input.version}: ${response.notes || "Approved for production"}`,entityType:"event",entityId:approval.event_id,actionUrl:`/events/events/${approval.event_id}`,metadata:{approvalId:approval.id,version:input.version}});
    return {approval:publicCreativeView(updated)};
  });
}

export async function publicCreativeProof(token) {
  return transaction(async () => {
    const approval = (await query("SELECT a.* FROM creative_approvals a JOIN events e ON e.id=a.event_id JOIN clients c ON c.id=a.client_id AND c.id=e.client_id WHERE a.public_token=$1 AND a.deleted_at IS NULL AND e.deleted_at IS NULL AND c.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED') FOR SHARE OF a",[token])).rows[0];
    if (!creativeAccess(approval)) throw new AppError("This design link is unavailable or expired.",404,"APPROVAL_ACCESS_UNAVAILABLE");
    const file = (await query("SELECT filename,mime_type,storage_key FROM files WHERE id=$1 AND event_id=$2 AND client_id=$3 AND deleted_at IS NULL AND mime_type IN ('image/png','image/jpeg','application/pdf')",[approval.proof_document_id,approval.event_id,approval.client_id])).rows[0];
    if (!file?.storage_key) throw new AppError("Proof file unavailable.",404,"NOT_FOUND");
    return file;
  });
}

export async function revokeCreativeApproval(id,req){
 return transaction(async()=>{
  await query('SELECT id FROM creative_approvals WHERE id=$1 FOR UPDATE',[id]);
  const {approval}=await getCreativeApproval(id,req.user);
  if(approval.status==='REVOKED')return {revoked:true,replayed:true};
  await query("UPDATE creative_approvals SET status='REVOKED',updated_at=now() WHERE id=$1",[id]);
  if(approval.communication_id)await query("UPDATE communications SET status='CANCELLED',updated_at=now() WHERE id=$1 AND status IN ('DRAFT','SCHEDULED','FAILED')",[approval.communication_id]);
  await recordActivity({actorUserId:req.user.id,entityType:'event',entityId:approval.event_id,action:'approval_access_revoked',summary:'Creative client link revoked'});
  await writeAudit({req,action:'approval_access_revoked',entity:'creative_approval',entityId:id,after:{version:approval.version}});
  return {revoked:true};
 });
}
