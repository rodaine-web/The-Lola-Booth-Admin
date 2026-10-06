import {useEffect,useState} from 'react';
import {useParams} from 'react-router-dom';
import {formatDateOnly,formatMoney} from '../utils/display.js';
const API=window.location.hostname==='stagingadmin.thelolabooth.com'?'https://stagingapi.thelolabooth.com/api':import.meta.env.VITE_API_URL||'/api';
export default function ClientWorkspace(){
 const {token}=useParams();const [workspace,setWorkspace]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError('');setWorkspace(null);
  fetch(`${API}/public/workspaces/${token}`,{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Unable to open your event.');return data;}).then(data=>{if(!controller.signal.aborted)setWorkspace(data);}).catch(err=>{if(!controller.signal.aborted&&err.name!=='AbortError')setError(err.message);});
  return()=>controller.abort();
 },[token,refresh]);
 return <main className="client-workspace"><header><img src="/brand/LOLA_Primary_Dark_Transparent.png" alt="The Lola Booth" width="140"/><button onClick={()=>setRefresh(value=>value+1)}>Refresh</button></header>
  {error&&<p className="toast error" role="alert">{error}</p>}
  {!workspace&&!error&&<p role="status">Opening your event…</p>}
  {workspace&&<><p className="eyebrow">Your Lola Booth event</p><h1>{workspace.event.name}</h1><p>{workspace.client} · {workspace.event.date?formatDateOnly(workspace.event.date):'Date to be confirmed'}{workspace.event.venue?` · ${workspace.event.venue}`:''}</p>
  <div className="workspace-documents"><section className="panel"><h2>Your proposal</h2><p>{workspace.proposal.number} · {workspace.proposal.status}</p><p>Total {formatMoney(workspace.proposal.total)}</p><DocumentLink url={workspace.proposal.url} label="View proposal"/></section>
  <section className="panel"><h2>Your agreements</h2>{workspace.agreements.length?workspace.agreements.map(agreement=><article key={agreement.id}><h3>{agreement.title}</h3><p>Revision {agreement.revision} · {agreement.status==='SIGNED'?`Signed by ${agreement.signerName}`:'Ready for your signature'}</p><DocumentLink url={agreement.url} label={agreement.status==='SIGNED'?'View signed agreement':'Review and sign'}/></article>):<p>Your agreement will appear here when it is ready.</p>}</section>
  <section className="panel"><h2>Invoices and payments</h2>{workspace.invoices.length?workspace.invoices.map(invoice=><article key={invoice.id}><h3>{invoice.number}</h3><p>{invoice.status} · Total {formatMoney(invoice.total)} · Balance {formatMoney(invoice.balance)}</p>{invoice.dueDate&&<p>Due {formatDateOnly(invoice.dueDate)}</p>}<DocumentLink url={invoice.url} label={invoice.balance>0?'View invoice and pay':'View invoice'}/></article>):<p>Your issued invoices will appear here.</p>}</section>
  <section className="panel"><h2>Payment receipts</h2>{workspace.receipts.length?workspace.receipts.map(receipt=><article key={receipt.id}><p>{formatMoney(receipt.amount)} · {receipt.status.replaceAll('_',' ')}{receipt.date?` · ${formatDateOnly(receipt.date)}`:''}</p><DocumentLink url={receipt.url} label="View receipt"/></article>):<p>Your receipts will appear after payment is recorded.</p>}</section></div></>}
 </main>;
}
function DocumentLink({url,label}){return url?<a className="primary-action" href={url} target="_blank" rel="noreferrer">{label}</a>:<p>This document link is unavailable. Contact The Lola Booth for access.</p>;}
