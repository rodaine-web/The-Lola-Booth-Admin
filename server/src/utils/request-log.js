// Keep route diagnostics useful without logging public document/setup credentials.
export function safeRequestLog(req) {
  const pathname = String(req.url || '').split('?')[0];
  const url = pathname.replace(/(\/api\/public\/campaigns\/(?:track\/(?:open|click)|interest|unsubscribe)\/)[^/]+/g, '$1[redacted]').replace(/(\/api\/gallery\/(?:access\/[ap]|media)\/)[^/]+/g, '$1[redacted]').replace(/(\/api\/public\/(?:proposals|invoices|receipts|delivery|approvals|contracts|workspaces)\/)[^/]+/g, '$1[redacted]');
  return { id: req.id, method: req.method, url, remoteAddress: req.remoteAddress };
}

// Redirect targets can contain recipient credentials; keep them out of HTTP logs.
export function safeResponseLog(res) {
 const headers={...(res.getHeaders?.()||res.headers||{})};
 for(const key of Object.keys(headers))if(['location','set-cookie'].includes(key.toLowerCase()))headers[key]='[redacted]';
 return {statusCode:res.statusCode,headers};
}
