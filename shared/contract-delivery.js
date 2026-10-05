export function contractDeliveryDecision(delivery) {
 if(!delivery) return 'SEND';
 if(['SENT_TO_PROVIDER'].includes(delivery.status)) return 'COMPLETE';
 if(['PROCESSING','UNKNOWN'].includes(delivery.status)) return 'REVIEW';
 if(delivery.status==='DEVELOPMENT_ONLY') return 'SEND';
 if(delivery.attempt_count>=3) return 'EXHAUSTED';
 return 'SEND';
}
// A known provider rejection is retryable. Timeout/network failures can follow
// acceptance and must not automatically re-send.
export function contractDeliveryFailure(error) {
 const code=String(error?.code||'EMAIL_DELIVERY_FAILED');
 const definiteCodes=new Set(['MICROSOFT_TOKEN_FAILED','MICROSOFT_TOKEN_INVALID','EMAIL_PROVIDER_MISCONFIGURED','EMAIL_PROVIDER_UNSUPPORTED','MICROSOFT_AUTH_REJECTED','MICROSOFT_SEND_FORBIDDEN','MICROSOFT_MAILBOX_NOT_FOUND','MICROSOFT_RATE_LIMITED','MICROSOFT_SEND_FAILED','CONTRACT_CHANGED','STAGING_EMAIL_PAUSED','STAGING_RECIPIENT_BLOCKED']);
 const knownRejection=error?.details?.outcomeUnknown!==true&&definiteCodes.has(code);
 return {status:knownRejection?'FAILED':'UNKNOWN',code};
}
