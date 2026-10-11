/** Derive next actions from independent records; never treat an email or screen as confirmation. */
export function bookingNextAction({ commercialAccepted = false, invoice = null, contract = null,
  netPaid = 0, total = 0, event = null, resourcesAvailable = false, workspaceInvited = false,
  planningStatus = null, shortNotice = false, requiredPayment = null } = {}) {
  const cents = value => Math.round(Number(value) * 100);
  if (event?.status === 'CANCELLED' || ['VOID', 'REFUNDED'].includes(invoice?.status)) return 'REVIEW_CLOSED_BOOKING';
  if (!commercialAccepted) return 'ACCEPT_PROPOSAL';
  if (!Number.isFinite(Number(total)) || cents(total) <= 0) return 'REVIEW_PRICING';
  if (!invoice) return 'CREATE_SEND_INVOICE';
  if (invoice.status === 'DRAFT') return 'SEND_INVOICE';
  if (!Number.isFinite(Number(netPaid)) || cents(netPaid) < Math.ceil(cents(total) * 0.3)) return 'PAY_BOOKING_RETAINER_FEE';
  if (!contract || contract.status === 'DRAFT') return 'PREPARE_SEND_AGREEMENT';
  if (contract.status !== 'SIGNED') return contract.status === 'ISSUED' ? 'SIGN_AGREEMENT' : 'REVIEW_AGREEMENT';
  // Signing unlocks the workspace invitation, not planning or booking confirmation.
  if (!workspaceInvited) return 'SEND_WORKSPACE_INVITATION';
  const required = requiredPayment == null ? (shortNotice ? cents(total) : Math.ceil(cents(total) * 0.3)) : cents(requiredPayment);
  if (!Number.isFinite(required) || required < 0 || required > cents(total)) return 'REVIEW_PAYMENT_REQUIREMENT';
  if (cents(netPaid) < required) return 'PAY_REQUIRED_BALANCE';
  if (!resourcesAvailable) return 'REVIEW_RESOURCE_AVAILABILITY';
  if (!['CONFIRMED', 'PREPARING', 'READY', 'IN_PROGRESS', 'COMPLETED'].includes(event?.status)) return 'CONFIRM_BOOKING';
  if (planningStatus === 'APPROVED') return 'PLANNING_APPROVED';
  if (planningStatus === 'SUBMITTED') return 'REVIEW_EVENT_DETAILS';
  return 'COMPLETE_EVENT_DETAILS';
}
