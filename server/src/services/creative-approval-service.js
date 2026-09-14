import { query, transaction } from "../db/pool.js";
import { AppError } from "../utils/errors.js";
import { recordActivity } from "./activity-service.js";
import { createCommunicationDraft } from "./automation-service.js";

function snapshot(input = {}) {
  return {
    approvalType: input.approval_type || input.approvalType,
    proofUrl: input.proof_url || input.proofUrl,
    version: input.version || 1,
    metadata: input.metadata || {},
    capturedAt: new Date().toISOString()
  };
}

export async function listCreativeApprovals(filters = {}) {
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
     ORDER BY ca.updated_at DESC, ca.created_at DESC
     LIMIT 100`,
    values
  );
  return { data: result.rows };
}

export async function createCreativeApproval(input = {}, user = {}) {
  const result = await query(
    `INSERT INTO creative_approvals (
       event_id, client_id, approval_type, status, proof_document_id, proof_url, version,
       expires_at, revision_notes, metadata, approval_snapshot, created_by
     ) VALUES ($1,$2,$3,'DRAFT',$4,$5,1,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      input.event_id || null,
      input.client_id || null,
      input.approval_type || "DESIGN",
      input.proof_document_id || null,
      input.proof_url || null,
      input.expires_at || null,
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
}

export async function getCreativeApproval(id) {
  const approval = (await query("SELECT * FROM creative_approvals WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
  if (!approval) throw new AppError("Approval not found.", 404, "APPROVAL_NOT_FOUND");
  const revisions = await query("SELECT * FROM creative_approval_revisions WHERE approval_id=$1 ORDER BY version DESC", [id]);
  return { approval, revisions: revisions.rows };
}

export async function createApprovalRevision(id, input = {}, user = {}) {
  return transaction(async (client) => {
    const approval = (await client.query("SELECT * FROM creative_approvals WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id])).rows[0];
    if (!approval) throw new AppError("Approval not found.", 404, "APPROVAL_NOT_FOUND");
    const nextVersion = Number(approval.version || 1) + 1;
    const approvalSnapshot = snapshot({ ...approval, ...input, version: nextVersion });
    const updated = await client.query(
      `UPDATE creative_approvals
       SET version=$1, status='DRAFT', proof_document_id=$2, proof_url=$3, revision_notes=$4,
           approval_snapshot=$5, updated_at=now()
       WHERE id=$6 RETURNING *`,
      [nextVersion, input.proof_document_id || approval.proof_document_id, input.proof_url || approval.proof_url, input.revision_notes || null, approvalSnapshot, id]
    );
    await client.query(
      `INSERT INTO creative_approval_revisions (approval_id, version, proof_document_id, proof_url, status, notes, snapshot, created_by)
       VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7)`,
      [id, nextVersion, input.proof_document_id || approval.proof_document_id, input.proof_url || approval.proof_url, input.revision_notes || null, approvalSnapshot, user.id || null]
    );
    await recordActivity({ actorUserId: user.id, entityType: "event", entityId: approval.event_id, action: "approval_revision_created", summary: `Creative approval version ${nextVersion} created` });
    return updated.rows[0];
  });
}

export async function sendCreativeApprovalRequest(id, user = {}, req = null) {
  const detail = await getCreativeApproval(id);
  const approval = detail.approval;
  const url = `${req?.protocol || "https"}://${req?.get?.("host") || "lolabooths.com"}/approvals/${approval.public_token}`;
  await query("UPDATE creative_approvals SET status='PENDING_APPROVAL', requested_at=now(), updated_at=now() WHERE id=$1", [id]);
  const draft = await createCommunicationDraft({
    client_id: approval.client_id,
    event_id: approval.event_id,
    template_key: "creative_proof_ready",
    merge_data: {
      approval: { url, version: approval.version, status: "PENDING_APPROVAL" },
      client: { first_name: "there", name: "Client" }
    },
    send_mode: "REVIEW_BEFORE_SEND",
    status: "DRAFT",
    trigger_key: "APPROVAL_REQUESTED"
  }, user);
  await recordActivity({ actorUserId: user.id, entityType: "event", entityId: approval.event_id, action: "approval_requested", summary: `Creative approval version ${approval.version} requested` });
  return { approval: { ...approval, status: "PENDING_APPROVAL" }, communication: draft };
}

export async function publicCreativeApproval(token) {
  const approval = (await query("SELECT * FROM creative_approvals WHERE public_token=$1 AND deleted_at IS NULL", [token])).rows[0];
  if (!approval) throw new AppError("Approval not found.", 404, "APPROVAL_NOT_FOUND");
  if (approval.status === "PENDING_APPROVAL") {
    await query("UPDATE creative_approvals SET status='VIEWED', viewed_at=COALESCE(viewed_at, now()), updated_at=now() WHERE id=$1", [approval.id]);
    await recordActivity({ entityType: "event", entityId: approval.event_id, action: "approval_viewed", summary: `Creative approval version ${approval.version} viewed` });
    approval.status = "VIEWED";
  }
  return { approval };
}

export async function respondToCreativeApproval(token, input = {}) {
  const approval = (await query("SELECT * FROM creative_approvals WHERE public_token=$1 AND deleted_at IS NULL", [token])).rows[0];
  if (!approval) throw new AppError("Approval not found.", 404, "APPROVAL_NOT_FOUND");
  if (approval.status === "APPROVED") return { approval };
  const status = input.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
  const updated = await query(
    `UPDATE creative_approvals
     SET status=$1, approved_version=CASE WHEN $1='APPROVED' THEN version ELSE approved_version END,
         approved_by_name=$2, approved_by_email=$3, response_notes=$4, responded_at=now(),
         approval_snapshot=approval_snapshot || $5::jsonb, updated_at=now()
     WHERE id=$6 RETURNING *`,
    [
      status,
      input.name || null,
      input.email || null,
      input.notes || null,
      JSON.stringify({ response: { status, name: input.name, email: input.email, notes: input.notes, respondedAt: new Date().toISOString() } }),
      approval.id
    ]
  );
  await recordActivity({
    entityType: "event",
    entityId: approval.event_id,
    action: status === "APPROVED" ? "approval_approved" : "approval_changes_requested",
    summary: status === "APPROVED" ? `Creative approval version ${approval.version} approved` : `Changes requested for creative approval version ${approval.version}`
  });
  return { approval: updated.rows[0] };
}
