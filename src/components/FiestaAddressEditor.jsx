import {useEffect,useState} from 'react';
import {api} from '../api/client.js';

const fields=[['name','Recipient name'],['address_line1','Street address'],['address_line2','Apartment or suite'],['address_city','City'],['address_state','State'],['address_zip','ZIP code']];
export default function FiestaAddressEditor({albumId,rowId,onSaved,onCancel}){
 const [address,setAddress]=useState(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;api.get(`/gallery-admin/albums/${albumId}/fiesta-survey-review/${rowId}/address`).then(r=>{if(active)setAddress({...Object.fromEntries(fields.map(([key])=>[key,''])),...r.address,address_country:r.address.address_country||'US'});}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[albumId,rowId]);
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{const result=await api.patch(`/gallery-admin/albums/${albumId}/fiesta-survey-review/${rowId}/address`,{address,reason});await onSaved(result);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <form onSubmit={save} aria-label="Edit guest mailing address"><h3>Correct mailing address</h3><p>Original imports are preserved. Saving revalidates the address and resets any affected unsubmitted postcard to a draft for fresh approval.</p>
 {!address&&!error&&<p role="status">Loading private address…</p>}
 {address&&<><div className="fiesta-address-fields">{fields.map(([key,label])=><label key={key}>{label}<input type="text" required={key!=='address_line2'} value={address[key]} maxLength={key==='address_zip'?10:key==='name'?120:key==='address_city'?100:200} inputMode={key==='address_zip'?'numeric':undefined} onChange={e=>setAddress(a=>({...a,[key]:e.target.value}))}/></label>)}<label>Country<input value={address.address_country} maxLength={100} required onChange={e=>setAddress(a=>({...a,address_country:e.target.value}))}/></label></div>
 <p>US ZIP codes must contain five digits. Leading zeros are kept. Enter a two-letter state such as MN.</p>
 {address.address_country.toUpperCase()==='US'&&/^\d{4}$/.test(address.address_zip)&&<button type="button" onClick={()=>setAddress(a=>({...a,address_zip:'0'+a.address_zip}))}>Restore leading zero: 0{address.address_zip}</button>}
 <label>Correction reason<textarea required minLength={10} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="For example: restored ZIP zero dropped by Excel, confirmed from corrected spreadsheet."/></label><button disabled={busy||reason.trim().length<10}>{busy?'Saving…':'Save and revalidate address'}</button></>}
 <button type="button" disabled={busy} onClick={onCancel}>Cancel address edit</button>{error&&<p role="alert">{error}</p>}</form>;
}
