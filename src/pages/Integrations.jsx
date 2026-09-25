import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../api/client.js';
import AsyncState from '../components/AsyncState.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import {formatTimestamp} from '../utils/display.js';
export default function Integrations(){
 const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
 async function load(){setError('');try{setData((await api.get('/integrations/catalog')).data);}catch(e){setError(e.message);}}
 useEffect(()=>{load();},[]);
 async function test(provider){if(busy)return;setBusy(provider);setError('');try{const result=await api.post(`/integrations/${provider}/local-test`,{});setNotice(result.message);await load();}catch(e){setError(e.message);}finally{setBusy('');}}
 return <main className="page"><div className="page-heading"><div><p className="eyebrow">System</p><h1>Integrations</h1><p className="lede">Configuration, test evidence and provider activity are shown separately.</p></div><button onClick={load}>Refresh</button></div>{notice&&<p role="status" className="toast">{notice}</p>}<AsyncState loading={!data&&!error} error={error} onRetry={load} noun="integrations">{data&&['Communications','Payments','Marketing & Analytics','Website'].map(group=><section className="integration-section" key={group}><h2>{group}</h2><div className="integration-grid">{data.filter(x=>x.group===group).map(card=><article className="panel integration-card" key={card.provider}><div className="integration-heading"><h3>{card.label}</h3><StatusBadge status={card.status}/></div><p><strong>Mode:</strong> {card.mode}</p><p>{card.detail}</p><dl><dt>Configuration</dt><dd>{card.config.required?`${card.config.present} of ${card.config.required} fields present`:'No credentials required for this local status'}</dd><dt>Last successful activity</dt><dd>{card.lastSuccess?formatTimestamp(card.lastSuccess):'Not verified'} · {card.evidenceMode}</dd><dt>Last failed job</dt><dd>{card.lastFailure?formatTimestamp(card.lastFailure):'None recorded'}</dd></dl>{card.testAvailable&&<button disabled={Boolean(busy)} onClick={()=>test(card.provider)}>{busy===card.provider?'Testing…':card.provider==='STRIPE'?'Check test configuration':'Run local mock test'}</button>}<details><summary>Configuration guidance</summary><p>Credentials belong in the server environment, never in this browser.</p>{card.config.fields.length>0&&<ul>{card.config.fields.map(key=><li key={key}>{key}</li>)}</ul>}<Link to="/system/settings#integrations">Open integration preferences</Link></details></article>)}</div></section>)}</AsyncState><InboundHistory/></main>;
}

function InboundHistory(){
 const [data,setData]=useState(null),[error,setError]=useState('');
 async function load(){try{setData(await api.get('/integrations/overview'));}catch(e){setError(e.message);}}
 useEffect(()=>{load();},[]);
 async function retry(id){try{await api.post(`/integrations/failed-inbound/${id}/retry`,{});await load();}catch(e){setError(e.message);}}
 return <section className="panel"><h2>Lead Sources</h2><p>LinkedIn Lead Sync requires LinkedIn API approval. Inbound forms and mappings remain separate from marketing conversion dispatch.</p>{error&&<p role="alert">{error}</p>}{data?.leadSources?.map(source=><details key={source.provider}><summary>{source.provider} · {source.leads_received_count||0} leads received</summary><p>Last successful lead: {source.last_successful_lead_at?formatTimestamp(source.last_successful_lead_at):'None'}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(source.fieldMaps||[],null,2)}</pre></details>)}<h3>Failed inbound leads</h3>{data?.failedInbound?.length?data.failedInbound.map(item=><p key={item.id}>{item.provider} · {item.status} <button onClick={()=>retry(item.id)}>Retry inbound event</button></p>):<p>No failed inbound events.</p>}</section>;
}
