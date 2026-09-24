import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function AsyncState({loading=false,error,requestId,onRetry,noun='records',empty=false,children}) {
  if(error) return <section className="empty-state error-state" role="alert"><AlertTriangle size={22}/><h2>Unable to load {noun}</h2><p>{typeof error==='string'?error:'The request could not be completed. Please try again.'}</p>{requestId&&<small>Request reference: {requestId}</small>}{onRetry&&<button onClick={onRetry}><RefreshCw size={16}/>Retry</button>}</section>;
  if(loading) return <div className="empty-state" role="status" aria-live="polite">Loading {noun}…</div>;
  if(empty) return <div className="empty-state">No {noun} found.</div>;
  return children||null;
}
