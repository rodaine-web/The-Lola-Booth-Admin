// Keep route diagnostics useful without logging public document/setup credentials.
export function safeRequestLog(req) {
  const pathname = String(req.url || '').split('?')[0];
  const url = pathname.replace(/(\/api\/gallery\/(?:access\/[ap]|media)\/)[^/]+/g, '$1[redacted]').replace(/(\/api\/public\/(?:proposals|invoices|receipts|delivery|approvals)\/)[^/]+/g, '$1[redacted]');
  return { id: req.id, method: req.method, url, remoteAddress: req.remoteAddress };
}
