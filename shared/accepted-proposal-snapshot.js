/** Version rows freeze the offer at their root. Older wrappers may only contain proposal_snapshot. */
export function acceptedProposalSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  // A nested published copy can belong to the previous send. Never let it override
  // this version's own total, pricing or line items, including a valid zero total.
  return Object.hasOwn(snapshot, 'total') ? snapshot : snapshot.proposal_snapshot || snapshot;
}
