import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
export default function WebsiteDiagnostics(){
 const [data,setData]=useState(null),[error,setError]=useState('');
 async function load(){setError('');try{setData(await api.get('/website/staging/site'));}catch(e){setError(e.message);}}
 useEffect(()=>{load();},[]);
 return <main className="page"><div className="page-heading"><div><p className="eyebrow">Website · STAGING</p><h1>CMS connection</h1><p>Published staging content. Public V1 content is read-only.</p></div><button onClick={load}>Refresh status</button></div>{error&&<p role="alert">{error}</p>}{data&&<><section className="panel"><h2>Staging channel connected</h2><a href="/staging-site/index.html" target="_blank" rel="noreferrer">Open staging website ↗</a><p>Endpoint: /api/public/staging/site · Channel: {data.channel}</p></section><section className="panel"><h2>Published staging records</h2><table><thead><tr><th>Content</th><th>Count</th></tr></thead><tbody>{Object.entries(data).filter(([key,value])=>Array.isArray(value)||['content','settings'].includes(key)).map(([key,value])=><tr key={key}><td>{key}</td><td>{Object.keys(value).length}</td></tr>)}</tbody></table></section></>}</main>;
}
