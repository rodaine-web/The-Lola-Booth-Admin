// Provider amounts are integer minor units. Fees never reduce a client's credit.
export const disputeStatuses = ['warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented'];
export function disputeFundsWithheld(dispute) {
 if(!disputeStatuses.includes(dispute.status)||!Number.isSafeInteger(dispute.amount)||dispute.amount<=0||!Array.isArray(dispute.balance_transactions))throw new Error('Invalid dispute ledger');
 const seen=new Set();let movement=0;
 for(const row of dispute.balance_transactions){
  if(!/^txn_/.test(row?.id||'')||seen.has(row.id)||!Number.isSafeInteger(row.amount)||String(row.currency).toLowerCase()!==String(dispute.currency).toLowerCase())throw new Error('Invalid dispute balance transaction');
  seen.add(row.id);movement+=row.amount;
 }
 const withheld=Math.max(0,-movement);
 if(!Number.isSafeInteger(withheld)||withheld>dispute.amount)throw new Error('Dispute funds require review');
 // A formal dispute without its debit data is not treated as money held.
 // Fail for provider retry rather than guessing from an old event's type.
 if(['needs_response','under_review','lost'].includes(dispute.status)&&!dispute.balance_transactions.length)throw new Error('Dispute debit has not arrived');
 return withheld;
}
