export const CONTRACT_CONSENT = 'I have reviewed this agreement and agree to its terms. I consent to signing electronically and intend my typed name to be my signature.';
export function contractsEnabled(config = {}) {
  return config.APP_ENV === 'staging' || (!config.APP_ENV && config.NODE_ENV !== 'production');
}
export function proposalAllowsAgreement(status) {
  return status === 'ACCEPTED' || status === 'CONVERTED';
}
export function contractDocument(title, terms, snapshot) {
  return JSON.stringify(canonicalValue({ title, terms, snapshot }));
}
export function signingDecision(contract, input) {
  if (input.consent !== true) return {error:'CONSENT_REQUIRED',message:'Consent to electronic signing is required.'};
  if (input.documentHash !== contract.document_hash) return {error:'CONTRACT_CHANGED',message:'The agreement has changed. Reload it before signing.'};
  if (contract.status === 'SIGNED') {
    return contract.signer_email === input.email.toLowerCase() && contract.signer_name === input.name
      ? {replay:true} : {error:'CONTRACT_STATE',message:'This agreement has already been signed.'};
  }
  if (contract.status !== 'ISSUED') return {error:'CONTRACT_STATE',message:'This agreement is unavailable for signing.'};
  if (input.email.toLowerCase() !== contract.snapshot.client_email.toLowerCase()) return {error:'SIGNER_EMAIL_MISMATCH',message:'Use the client email shown on this agreement.'};
  return {replay:false};
}

function canonicalValue(value) {
 if(Array.isArray(value)) return value.map(canonicalValue);
 if(value && typeof value==='object') {
  if(typeof value.toJSON==='function') return canonicalValue(value.toJSON());
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])]));
 }
 return value;
}
