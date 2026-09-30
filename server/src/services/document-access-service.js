import crypto from "node:crypto";
import { transaction } from "../db/pool.js";
import { documentAccessState } from "../../../shared/document-access.js";
import { notFound } from "../utils/errors.js";

export async function recoverDocumentAccess(kind, id, req) {
  if (!["invoices", "proposals"].includes(kind)) throw new Error("Unsupported document kind");
  return transaction(async client => {
    const record = (await client.query(`SELECT * FROM ${kind} WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
    if (!record) throw notFound("Document");
    const previous = documentAccessState(record);
    if (previous === "AVAILABLE") return { id, changed: false };
    const token = crypto.randomBytes(32).toString("hex");
    const resets = kind === "invoices" ? ",token_revoked_at=NULL,token_expires_at=NULL" : "";
    await client.query(`UPDATE ${kind} SET secure_token=$1${resets},updated_at=now() WHERE id=$2`, [token, id]);
    // Audit in the same transaction; never store capability tokens in audit values.
    await client.query(`INSERT INTO audit_logs(user_id,actor_user_id,action,entity,entity_type,entity_id,before_value,before_json,after_value,after_json,ip_address,user_agent)
      VALUES($1,$1,$2,$3,$3,$4,$5,$5,$6,$6,$7,$8)`,
      [req.user?.id || null, "document_access_generated", kind, id, { state: previous }, { state: "AVAILABLE" }, req.ip, req.headers?.["user-agent"] || null]);
    return { id, changed: true };
  });
}
