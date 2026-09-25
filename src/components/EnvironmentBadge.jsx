import {useEffect,useState} from 'react';
const apiBase=import.meta.env.VITE_API_URL||'/api';
export default function EnvironmentBadge(){
 const [environment,setEnvironment]=useState(import.meta.env.VITE_APP_ENV||'');
 useEffect(()=>{let active=true;fetch(`${apiBase}/health`).then(r=>r.ok?r.json():null).then(data=>{if(active&&data?.environment)setEnvironment(data.environment);}).catch(()=>{});return()=>{active=false;};},[]);
 if(environment!=='staging')return null;
 return <span className="environment-badge" title={`Staging · Admin build ${__BUILD_REVISION__}`}>STAGING</span>;
}
