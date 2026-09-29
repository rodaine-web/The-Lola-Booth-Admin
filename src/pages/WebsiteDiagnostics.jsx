import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
const staging = import.meta.env.VITE_APP_ENV !== 'production';
const website = staging ? 'https://staging.thelolabooth.com' : 'https://thelolabooth.com';
export default function WebsiteDiagnostics(){
 const [data,setData]=useState(null),[error,setError]=useState('');
 async function load(){setError('');try{setData(await api.get(staging?'/website/staging/site':'/website/preview'));}catch(e){setError(e.message);}}
 useEffect(()=>{load();},[]);
 return <main className="page"><div className="page-heading"><div><p className="eyebrow">Website · {staging?'STAGING':'Production'}</p><h1>CMS connection</h1><p>Content from this environment’s database.</p></div><button onClick={load}>Refresh status</button></div>{error&&<p role="alert">{error}</p>}{data&&<><section className="panel"><h2>{staging?'Staging':'Production'} CMS connected</h2><a href={website} target="_blank" rel="noreferrer">Open website ↗</a></section><section className="panel"><h2>CMS records</h2><table><thead><tr><th>Content</th><th>Count</th></tr></thead><tbody>{Object.entries(data).filter(([key,value])=>Array.isArray(value)||['content','settings'].includes(key)).map(([key,value])=><tr key={key}><td>{key}</td><td>{Object.keys(value||{}).length}</td></tr>)}</tbody></table></section></>}</main>;
}
