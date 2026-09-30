// Shared presentation guard. Authorization is still enforced by the public API.
export function documentAccessState(record, now = Date.now()) {
  const token = record?.secure_token;
  if (typeof token !== "string" || !token.trim() || ["null", "undefined"].includes(token.toLowerCase())) return "MISSING";
  if (record.token_revoked_at) return "REVOKED";
  if (record.token_expires_at && (!Number.isFinite(Date.parse(record.token_expires_at)) || Date.parse(record.token_expires_at) <= now)) return "EXPIRED";
  return "AVAILABLE";
}
export function secureDocumentUrl(origin, kind, record) {
  if (documentAccessState(record) !== "AVAILABLE") return null;
  return `${origin.replace(/\/$/, "")}/${kind}/${encodeURIComponent(record.secure_token)}`;
}
