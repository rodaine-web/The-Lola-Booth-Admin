import {useEffect,useState} from 'react';
import {api} from '../api/client.js';

export {mergeCampaignSelections} from '../../shared/campaign-selection.js';
export default function CampaignPackagePicker({experienceId,onSelect}){
 const [open,setOpen]=useState(false),[campaigns,setCampaigns]=useState([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!open)return;
  let live=true;setLoading(true);setError('');
  api.get('/campaigns/offers-for-proposals').then(result=>{if(live)setCampaigns(result.data||[]);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[open]);
 const available=campaigns.filter(c=>c.offers.some(o=>o.selections.some(s=>s.experience_id===experienceId)));
 const campaign=available.find(c=>c.id===selected);
 return <div className="campaign-package-picker">
  <button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Select from campaign</button>
  {open&&<><p>Campaign pricing and discounts are included automatically. Bundles select every included experience.</p>
   {loading&&<p role="status">Loading campaign offers…</p>}{error&&<p role="alert">{error}</p>}
   <label>Campaign<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose campaign</option>{available.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   {!loading&&!error&&!available.length&&<p>No campaigns offer this experience.</p>}
   {campaign?.offers.filter(o=>o.selections.some(s=>s.experience_id===experienceId)).map(o=><button type="button" className="package-card" key={o.key} onClick={()=>onSelect(o)}><strong>{o.name}</strong>{o.saving>0&&<s>${o.original.toFixed(2)}</s>} <b>${o.discounted.toFixed(2)}</b><small>{o.description}</small></button>)}
  </>}
 </div>;
}
