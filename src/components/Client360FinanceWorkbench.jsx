import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import DocumentPreview from './DocumentPreview.jsx';
import { BadgeCheck, CreditCard, Download, Eye, FileText, Receipt, RefreshCw, Send, ShieldCheck, X, AlertCircle, CalendarClock } from 'lucide-react';

const rows = x => Array.isArray(x) ? x : [];
const currency = x => Number.isFinite(Number(x)) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(x)) : '—';
const pretty = x => String(x ?? 'Not set').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,m=>m.toUpperCase());
const date = x => x ? new Date(x).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
function validId(x){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x||'');}

/** All downloads/previews are authenticated Admin API calls; no client token or public URL is used. */
export default function Client360FinanceWorkbench({client,event,invoices=[],proposals=[],payments=[],onUpdated}){
  const {can}=useAuth();
  const [kind,setKind]=useState('invoice');
  const [chosen,setChosen]=useState(null);
  const [detail,setDetail]=useState(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [confirm,setConfirm]=useState('');
  const [manual,setManual]=useState({amount:'',payment_method:'BANK_TRANSFER',payment_date:new Date().toISOString().slice(0,10),reference_number:''});
  const [showManual,setShowManual]=useState(false);
  const authorized=can('read:finance');
  const permittedRows=useMemo(()=>({invoice:rows(invoices),proposal:can('read:sales')?rows(proposals):[],receipt:rows(payments)}),[invoices,proposals,payments,can]);
  const records=permittedRows[kind]||[];
  const due=permittedRows.invoice.reduce((n,i)=>n+Number(i.amount_outstanding??i.balance_due??0),0);
  const paid=permittedRows.receipt.reduce((n,p)=>n+Number(p.amount||0)-Number(p.refunded_amount||0),0);
  const record=records.find(r=>r.id===chosen?.id)||null;
  useEffect(()=>{setChosen(null);setDetail(null);setError('');setNotice('');setConfirm('');setShowManual(false);},[event?.id,client?.id,kind]);
  useEffect(()=>{let alive=true;setDetail(null);setError('');if(!record?.id||!validId(record.id))return()=>{alive=false;};
    const path=kind==='invoice'?`/invoices/${record.id}`:kind==='proposal'?`/proposals/${record.id}`:`/payments/${record.id}`;
    api.get(path).then(data=>{if(!alive)return;if(data.client_id && data.client_id!==client.id)throw Error('Document does not belong to this client.');if(event?.id&&data.event_id&&data.event_id!==event.id)throw Error('Document does not belong to the selected event.');setDetail(data);}).catch(e=>{if(alive)setError(e.message||'Unable to open record.');});
    return()=>{alive=false;};},[record?.id,kind,client?.id,event?.id]);
  async function download(){if(!record||!detail)return;setBusy(true);setError('');try{
    const stem=(detail.invoice_number||detail.proposal_number||detail.id||'document').replace(/[^a-z0-9_-]/ig,'_').slice(0,100);
    const path=kind==='invoice'?`/invoices/${detail.id}/pdf`:kind==='proposal'?`/proposals/${detail.id}/pdf`:`/payments/${detail.id}/receipt.pdf`;
    await api.download(path,`${kind==='receipt'?'receipt-':''}${stem}.pdf`);
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  async function submitAction(){if(!record||!detail||!confirm||busy)return;setBusy(true);setError('');setNotice('');try{
    if(confirm==='sendInvoice'&&kind==='invoice')await api.post(`/invoices/${detail.id}/send`,{});
    else if(confirm==='sendProposal'&&kind==='proposal')await api.post(`/proposals/${detail.id}/send`,{});
    else if(confirm==='manualPayment'&&kind==='invoice'){
      const amount=Number(manual.amount);
      if(!Number.isFinite(amount)||amount<=0||amount>Number(detail.amount_outstanding??detail.balance_due??0))throw Error('Enter an amount within the outstanding balance.');
      if(!manual.reference_number.trim())throw Error('Enter the external payment reference.');
      await api.post('/payments',{...manual,amount:amount.toFixed(2),invoice_id:detail.id,client_id:detail.client_id,event_id:detail.event_id||null,
        idempotency_key:`c360-${detail.id}-${manual.payment_date}-${manual.payment_method}-${manual.reference_number.trim()}`});
      setShowManual(false);setManual(v=>({...v,amount:'',reference_number:''}));
    }else throw Error('Action is not available for this document.');
    setNotice(confirm==='manualPayment'?'Manual payment recorded.': 'Submitted to the existing delivery workflow.');
    await onUpdated?.();setDetail(await api.get(kind==='invoice'?`/invoices/${detail.id}`:`/proposals/${detail.id}`));
  }catch(e){setError(e.message||'Action failed.');}finally{setBusy(false);setConfirm('');}}
  if(!authorized)return <div role="status" className="c360-fw-empty">You do not have finance access.</div>;
  const path=detail&&kind==='invoice'?`/invoices/${detail.id}/pdf`:detail&&kind==='proposal'?`/proposals/${detail.id}/pdf`:detail&&kind==='receipt'?`/payments/${detail.id}/receipt.pdf`:null;
  const isScopeCorrect=detail&&(!detail.client_id||detail.client_id===client?.id)&&(!event?.id||!detail.event_id||detail.event_id===event.id);
  const canSendInvoice=kind==='invoice'&&can('write:finance')&&['DRAFT','SENT','PARTIALLY_PAID','OVERDUE'].includes(String(detail?.status||'').toUpperCase());
  const canSendProposal=kind==='proposal'&&can('write:sales')&&['DRAFT','READY','SENT'].includes(String(detail?.status||'').toUpperCase());
  return <div className="c360-fw">
    <div className="c360-fw-top"><div><span className="c360-fw-eyebrow"><ShieldCheck size={15}/> CLIENT FINANCIAL WORKSPACE</span><h3>Documents, payments & receipts</h3><p>Select a record to inspect its details, preview its PDF and download a copy. All actions stay inside Client 360.</p></div><button type="button" onClick={()=>onUpdated?.()}><RefreshCw size={15}/> Refresh records</button></div>
    <div className="c360-fw-stats"><div><span>Outstanding balance</span><strong>{currency(due)}</strong><small>{permittedRows.invoice.length} invoices</small></div><div><span>Recorded net payments</span><strong>{currency(paid)}</strong><small>{permittedRows.receipt.length} payments</small></div><div><span>Proposals</span><strong>{permittedRows.proposal.length}</strong><small>Client and selected event</small></div></div>
    <div className="c360-fw-tabs" role="group" aria-label="Financial record type">{[['invoice','Invoices',FileText],['receipt','Receipts',Receipt],['proposal','Proposals',CreditCard]].filter(([x])=>x!=='proposal'||can('read:sales')).map(([id,label,Icon])=><button type="button" key={id} aria-pressed={kind===id} className={kind===id?'active':''} onClick={()=>setKind(id)}><Icon size={17}/>{label}<span>{permittedRows[id].length}</span></button>)}</div>
    <div className="c360-fw-grid">
      <section className="c360-fw-list" aria-label="Financial documents">
        {records.length===0?<div className="c360-fw-empty">No {kind==='receipt'?'payments':`${kind}s`} found for this selection.</div>:records.map(r=><button type="button" key={r.id} className={`c360-fw-item ${record?.id===r.id?'active':''}`} onClick={()=>{setChosen(r);setConfirm('');setNotice('');}}><span className="c360-fw-file-icon"><FileText size={21}/></span><span className="c360-fw-item-main"><strong>{kind==='invoice'?r.invoice_number||'Invoice':kind==='proposal'?r.proposal_number||'Proposal':r.receipt_number||r.reference_number||`Payment ${String(r.id||'').slice(0,8)}`}</strong><small>{pretty(r.status||r.payment_method)} · {date(r.created_at||r.payment_date)}</small></span><span className="c360-fw-amount">{currency(kind==='receipt'?r.amount:r.total)}</span></button>)}
      </section>
      <section className="c360-fw-detail" aria-label="Selected financial record">
        {!record?<div className="c360-fw-placeholder"><Eye size={30}/><h4>Select a {kind==='receipt'?'payment':kind}</h4><p>The PDF preview and financial details will appear here.</p></div>: !detail?<div role="status" className="c360-fw-placeholder">{error||'Loading document details…'}</div>:!isScopeCorrect?<p role="alert">This record is outside the selected client or event.</p>:<>
          <div className="c360-fw-document-head"><div><span className="c360-fw-eyebrow">{kind==='receipt'?'PAYMENT RECEIPT':kind.toUpperCase()}</span><h3>{detail.invoice_number||detail.proposal_number||detail.receipt_number||'Payment record'}</h3><span className="c360-fw-status"><BadgeCheck size={14}/>{pretty(detail.status)}</span></div><div className="c360-fw-document-actions"><button type="button" disabled={busy} onClick={download}><Download size={16}/> Download PDF</button></div></div>
          <div className="c360-fw-data"><div><small>{kind==='receipt'?'Payment amount':'Total'}</small><strong>{currency(detail.amount??detail.total)}</strong></div><div><small>{kind==='invoice'?'Balance due':kind==='receipt'?'Payment date':'Document status'}</small><strong>{kind==='invoice'?currency(detail.amount_outstanding??detail.balance_due):kind==='receipt'?date(detail.payment_date||detail.paid_at):pretty(detail.status)}</strong></div><div><small>{kind==='invoice'?'Due date':kind==='receipt'?'Payment method':'Created'}</small><strong>{kind==='invoice'?date(detail.due_date):kind==='receipt'?pretty(detail.payment_method):date(detail.created_at)}</strong></div></div>
          {error&&<p role="alert" className="c360-fw-error">{error}</p>}{notice&&<p role="status" className="c360-fw-success">{notice}</p>}
          {path?<DocumentPreview key={path} path={path} title={`${kind==='invoice'?'Invoice':kind==='proposal'?'Proposal':'Receipt'} PDF preview`}/>:<div className="c360-fw-receipt"><Receipt size={26}/><h4>Receipt ready</h4><p>Download the authenticated PDF receipt for this recorded payment. The payment provider and reference are displayed below.</p><dl><div><dt>Provider</dt><dd>{detail.provider||'—'}</dd></div><div><dt>Reference</dt><dd>{detail.provider_payment_id||detail.reference_number||'—'}</dd></div><div><dt>Refunded</dt><dd>{currency(detail.refunded_amount||0)}</dd></div></dl></div>}
          {kind==='invoice'&&rows(detail.items).length>0&&<div className="c360-fw-lines"><h4>Invoice line items</h4>{rows(detail.items).map((item,i)=><div key={item.id||i}><span>{item.description}</span><strong>{currency(item.line_total)}</strong></div>)}</div>}
          {kind==='invoice'&&rows(detail.payments).length>0&&<div className="c360-fw-lines"><h4>Payments against this invoice</h4>{rows(detail.payments).map((p,i)=><div key={p.id||i}><span>{date(p.payment_date)} · {pretty(p.payment_method)}</span><button type="button" onClick={()=>{setKind('receipt');setChosen(p);}}>{currency(p.amount)} · Preview receipt</button></div>)}</div>}
          {(canSendInvoice||canSendProposal)&&<div className="c360-fw-tools"><div><strong>Client engagement</strong><p>Send the document through the existing delivery service. Confirm the recipient and status first.</p></div><button type="button" disabled={busy} onClick={()=>setConfirm(canSendInvoice?'sendInvoice':'sendProposal')}><Send size={15}/> {kind==='invoice'?'Send invoice':'Send proposal'}</button></div>}
          {kind==='invoice'&&can('write:finance')&&Number(detail.amount_outstanding??detail.balance_due)>0&&<div className="c360-fw-tools"><div><strong>Record an external payment</strong><p>For verified payments received outside the portal. This does not charge a card.</p></div><button type="button" onClick={()=>setShowManual(v=>!v)}>Record payment</button></div>}
          {showManual&&kind==='invoice'&&can('write:finance')&&<form className="c360-fw-payment" onSubmit={e=>{e.preventDefault();setConfirm('manualPayment');}}><label>Amount<input required type="number" min="0.01" step="0.01" max={detail.amount_outstanding??detail.balance_due} value={manual.amount} onChange={e=>setManual(v=>({...v,amount:e.target.value}))}/></label><label>Payment method<select value={manual.payment_method} onChange={e=>setManual(v=>({...v,payment_method:e.target.value}))}>{['CASH','CHECK','BANK_TRANSFER','ZELLE','EXTERNAL_CARD','OTHER'].map(m=><option key={m} value={m}>{pretty(m)}</option>)}</select></label><label>Payment date<input required type="date" value={manual.payment_date} onChange={e=>setManual(v=>({...v,payment_date:e.target.value}))}/></label><label>Reference<input required maxLength={120} value={manual.reference_number} onChange={e=>setManual(v=>({...v,reference_number:e.target.value}))}/></label><button type="submit" disabled={busy}>Review payment record</button></form>}
        </>}
      </section>
    </div>
    {confirm&&detail&&<div role="presentation" className="c360-fw-confirm-back"><section role="dialog" aria-modal="true" aria-labelledby="c360-fw-confirm-title" className="c360-fw-confirm"><button type="button" aria-label="Cancel" className="c360-fw-close" onClick={()=>setConfirm('')}><X size={18}/></button><AlertCircle size={25}/><h3 id="c360-fw-confirm-title">Confirm {confirm==='manualPayment'?'manual payment':'document delivery'}</h3><p>{confirm==='manualPayment'?`Record ${currency(manual.amount)} received via ${pretty(manual.payment_method)}? This action creates a financial record.`:`Send ${detail.invoice_number||detail.proposal_number} using the existing email provider workflow? This can contact the client.`}</p><div><button type="button" onClick={()=>setConfirm('')}>Cancel</button><button type="button" className="primary-action" disabled={busy} onClick={submitAction}>{busy?'Processing…':'Confirm action'}</button></div></section></div>}
  </div>;
}

/** A truthful alignment summary from server-side event records; never acts as a client. */
export function Client360EngagementPulse({event,client,onNavigate}){
 const ops=event?.operations;const checks=rows(ops?.readiness?.items);const pending=checks.filter(x=>x.status==='INCOMPLETE');
 return <section className="c360-engagement" aria-label="Client experience coordination"><div className="c360-engagement-title"><CalendarClock size={19}/><div><h3>Client journey & next actions</h3><p>Staff-facing coordination using the same underlying event record. This is not a live client-session preview.</p></div></div>
  <div className="c360-engagement-steps">{[['Planning','planning','Questionnaires, event details and creative proofs'],['Documents','files','Approved materials and internal files'],['Financials','finance','Proposals, invoices, payments and receipts'],['Delivery','gallery','Event gallery and post-event sharing']].map(([name,target,desc],i)=><button key={name} type="button" onClick={()=>onNavigate(target)}><span className="c360-engagement-step-num">{i+1}</span><strong>{name}</strong><small>{desc}</small><span>Open {name.toLowerCase()} →</span></button>)}</div>
  {pending.length>0&&<div className="c360-engagement-alert"><AlertCircle size={17}/><p><strong>{pending.length} readiness items outstanding.</strong> Review staff-owned and client-dependent blockers before confirming readiness.</p><button onClick={()=>onNavigate('readiness')}>Review blockers</button></div>}
 </section>;
}
