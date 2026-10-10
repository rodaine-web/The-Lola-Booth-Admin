import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../api/client.js';

export default function AgreementList({clientId,eventId}) {
 const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1),[result,setResult]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[busy,setBusy]=useState('');
 useEffect(()=>{let current=true;setResult(null);setError('');const params=new URLSearchParams({search,page:String(page),pageSize:'25',...(status?{status}:{}),...(clientId?{clientId}:{}),...(eventId?{eventId}:{})});
 const timer=setTimeout(()=>api.get(`/contracts?${params}`).then(data=>{if(current)setResult(data);}).catch(err=>{if(current)setError(err.message);}),200);
 return()=>{current=false;clearTimeout(timer);};},[search,status,page,clientId,eventId,retry]);
 async function download(row){setBusy(row.id);setError('');try{await api.download(`/contracts/${row.id}/pdf`,`LOLA-agreement-${row.id.slice(0,8)}.pdf`);}catch(err){setError(err.message);}finally{setBusy('');}}
 return <section className="panel"><div className="filter-bar"><label>Search agreements<input type="search" placeholder="Client, event, proposal or agreement ID" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><label>Status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All statuses</option>{['DRAFT','ISSUED','SIGNED','REVOKED'].map(value=><option key={value} value={value}>{value==='ISSUED'?'Awaiting signature':value}</option>)}</select></label></div>
 {error&&<p role="alert">{error} <button onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
 {!result&&!error&&<p role="status">Loading agreements…</p>}
 {result&&<><p>{result.total} agreements</p><div style={{overflowX:'auto'}}><table><thead><tr>{['Agreement','Client / Event','Proposal','Status','Signed / Due','Actions'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{result.rows.map(row=><tr key={row.id}><td>{row.title}<br/><small>Revision {row.revision} · {row.id.slice(0,8)}</small></td><td>{row.client_name||'—'}<br/>{row.event_name||'—'}</td><td>{row.proposal_number}</td><td>{row.status==='ISSUED'?'Awaiting signature':row.status}</td><td>{row.signed_at?new Date(row.signed_at).toLocaleDateString():row.signing_due_at?`Due ${new Date(row.signing_due_at).toLocaleDateString()}`:'—'}</td><td><Link to={`/sales/proposals/${row.proposal_id}#agreements`}>View agreement</Link> <button disabled={!!busy} onClick={()=>download(row)}>{busy===row.id?'Downloading…':'Download PDF'}</button></td></tr>)}</tbody></table></div>{!result.rows.length&&<p>No agreements match these filters.</p>}<div className="button-row"><button disabled={page===1} onClick={()=>setPage(value=>value-1)}>Previous</button><span>Page {page}</span><button disabled={page*25>=result.total} onClick={()=>setPage(value=>value+1)}>Next</button></div></>}
 </section>;
}
