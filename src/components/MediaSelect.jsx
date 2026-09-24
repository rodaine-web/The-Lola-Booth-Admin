import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
export default function MediaSelect({value,onChange}){
 const [items,setItems]=useState([]),[search,setSearch]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let current=true;api.get('/website/media?search='+encodeURIComponent(search)).then(r=>{if(current){setItems(r.data||[]);setError('');}}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[search]);
 return <span className="relationship-select"><input aria-label="Search media library" placeholder="Search media by name" value={search} onChange={e=>setSearch(e.target.value)}/><select value={value||''} onChange={e=>onChange(e.target.value||null)}><option value="">Select media…</option>{value&&!items.some(i=>i.id===value)&&<option value={value}>Current media ({value})</option>}{items.map(i=><option key={i.id} value={i.id}>{i.original_filename||i.filename} · {i.visibility} / {i.permission_state}</option>)}</select>{error&&<small role="alert">{error}</small>}</span>;
}
