export function creativeAccess(approval, now = Date.now()) {
  return Boolean(approval && !approval.deleted_at && ['PENDING_APPROVAL','VIEWED','CHANGES_REQUESTED','APPROVED'].includes(approval.status) && approval.expires_at && new Date(approval.expires_at).getTime() > now);
}
export function creativeResponseError(approval, input, now = Date.now()) {
  if (!creativeAccess(approval, now)) return 'APPROVAL_ACCESS_UNAVAILABLE';
  if (!Number.isSafeInteger(input.version) || input.version !== Number(approval.version)) return 'APPROVAL_VERSION_CHANGED';
  if (!['approve','request_changes'].includes(input.action)) return 'APPROVAL_RESPONSE_INVALID';
  if (!String(input.name || '').trim() || !String(input.email || '').trim()) return 'APPROVAL_IDENTITY_REQUIRED';
  if (input.action === 'request_changes' && !String(input.notes || '').trim()) return 'APPROVAL_COMMENTS_REQUIRED';
  if (approval.status === 'APPROVED' && input.action !== 'approve') return 'APPROVAL_LOCKED';
  if (approval.status === 'CHANGES_REQUESTED') return 'APPROVAL_REVISION_REQUIRED';
  return null;
}
export function publicCreativeView(approval) {
  return {hasDocument:Boolean(approval.proof_document_id), ...Object.fromEntries(['approval_type','version','status','proof_url','approved_version','responded_at','expires_at'].map(key => [key,approval[key]]))};
}
