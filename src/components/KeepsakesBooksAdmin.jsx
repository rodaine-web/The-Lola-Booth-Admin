import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
const money=cents=>Number.isInteger(cents)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100):'Not verified';

export default function KeepsakesBooksAdmin({writable}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editor,setEditor]=useState(null),[amount,setAmount]=useState(''),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[supplier,setSupplier]=useState(null),[provider,setProvider]=useState('WHCC');
 const [productRef,setProductRef]=useState(''),[catalogRef,setCatalogRef]=useState(''),[pageCount,setPageCount]=useState('');
 const [mapping,setMapping]=useState(null),[mappingValues,setMappingValues]=useState({});
 useEffect(()=>{let active=true;api.get('/keepsakes-admin/books').then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 async function run(action){
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{await action();}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function reload(){setData(await api.get('/keepsakes-admin/books'));}
 async function inspect(operation){
  const params=new URLSearchParams({...(productRef?{product:productRef}:catalogRef?{catalog:catalogRef,search:'true'}:{}),operation,...(pageCount?{pageCount}:{})});
  setSupplier(await api.get('/keepsakes-admin/books/suppliers/'+provider+'?'+params));
 }
 function openMapping(variant){
  setEditor(null);setMapping(variant);setError('');setNotice('');
  setMappingValues({providerProductId:variant.provider_product_id||'',size:variant.specification?.size||String(variant.size||'').replace('×','x'),coverType:variant.specification?.selections?.cover_type||'material_cover',coverMaterial:variant.specification?.selections?.cover_material||'premium_leather_black',pageCount:variant.specification?.pageCount||28,reason:''});
 }
 async function saveMapping(){
  const body={providerProductId:mappingValues.providerProductId.trim(),reason:mappingValues.reason,...(mapping.provider==='GELATO'?{pageCount:Number(mappingValues.pageCount)}:{size:mappingValues.size,coverType:mappingValues.coverType,coverMaterial:mappingValues.coverMaterial})};
  const result=await api.put('/keepsakes-admin/books/variants/'+mapping.id+'/mapping',body);
  setMapping(null);await reload();setNotice('Catalogue mapping saved as a draft. '+result.blockers.join(' '));
 }
 async function savePrice(){
  await api.patch('/keepsakes-admin/books/variants/'+editor.id+'/price',{retailCents:Math.round(Number(amount)*100),reason});
  setEditor(null);await reload();setNotice('Variant price saved for future quotes.');
 }
 const mappingFields=mapping?.provider==='GELATO'
  ?[['providerProductId','Gelato product UID'],['pageCount','Supported API page count']]
  :[['providerProductId','WHCC product reference'],['size','Enabled size'],['coverType','Enabled cover type'],['coverMaterial','Enabled cover material']];
 return <section className="ka-panel ka-books-admin" aria-busy={busy}>
  <h2>Photo Books &amp; Albums</h2>
  {notice&&<p className="ka-notice" role="status">{notice}</p>}
  {error&&<p className="ka-error" role="alert">{error}</p>}
  {!data&&!error&&<p>Loading book variants…</p>}
  {data&&<>
   <p>WHCC test key: {data.credentials.whcc?'Configured':'Missing'} · Gelato key: {data.credentials.gelato?'Configured':'Missing'}</p>
   <p className="ka-sandbox">WHCC uses its test host. Gelato account type is unconfirmed: catalogue, specifications and pricing checks only. Order submission is unavailable.</p>
   <p>{data.workflow}</p>
   <div className="ka-actions">{['WHCC','GELATO'].map(name=><button key={name} disabled={busy} onClick={()=>run(async()=>setSupplier(await api.get('/keepsakes-admin/books/suppliers/'+name)))}>Check {name} catalogue</button>)}</div>
   <div className="ka-form">
    <fieldset className="ka-variant" disabled={busy}>
     <legend>Inspect a catalogue entry</legend>
     <p>Use identifiers returned by the catalogue. These controls check products, pages, cover dimensions and US costs without creating an order.</p>
     <div className="ka-book-fields">
      <label>Supplier<select value={provider} onChange={e=>setProvider(e.target.value)}><option>WHCC</option><option>GELATO</option></select></label>
      {provider==='GELATO'&&<label>Catalogue ID<input value={catalogRef} onChange={e=>setCatalogRef(e.target.value)} maxLength={100}/></label>}
      <label>Product ID / reference<input value={productRef} onChange={e=>setProductRef(e.target.value)} maxLength={400}/></label>
      {provider==='GELATO'&&<label>Supported page count<input type="number" min="1" max="1000" value={pageCount} onChange={e=>setPageCount(e.target.value)}/></label>}
     </div>
     <div className="ka-actions">{['DETAIL',...(provider==='GELATO'&&productRef?['PRICES','COVER']:[])].map(operation=><button key={operation} disabled={busy||(operation==='COVER'&&!pageCount)} onClick={()=>run(()=>inspect(operation))}>{operation==='DETAIL'?'Inspect catalogue/product':operation==='PRICES'?'Check US cost':'Check cover dimensions'}</button>)}</div>
    </fieldset>
   </div>
   {supplier&&<details open><summary>{supplier.provider} · Read-only catalogue · {new Date(supplier.checkedAt).toLocaleString()}</summary><pre className="ka-supplier-result">{JSON.stringify(supplier.data,null,2)}</pre></details>}
   <div className="ka-product-grid">{data.variants.map(variant=><article key={variant.id} className="ka-panel ka-book-variant">
    <h3>{variant.label}</h3>
    <p>{variant.audience} · {variant.cover} · {variant.specification?.size||variant.size||'Size awaiting verification'}</p>
    <p>{variant.provider} · {variant.status}</p>
    <p className="ka-muted">{variant.provider_product_id||'No verified product mapping'}</p>
    <p>Proposed retail {money(variant.retail_cents)} · Provider cost {money(variant.provider_cost_cents)}</p>
    {variant.provider_cost_cents!=null&&<p className="ka-muted">Product cost only. Shipping, tax and final configuration are checked separately.</p>}
    {variant.verified_at&&<p>Catalogue checked {new Date(variant.verified_at).toLocaleString()}. Final print proof still required.</p>}
    {variant.specification?.blockers?.length>0&&<ul>{variant.specification.blockers.map(text=><li key={text}>{text}</li>)}</ul>}
    {writable&&<div className="ka-actions"><button disabled={busy} onClick={()=>openMapping(variant)}>Verify catalogue mapping</button><button disabled={busy} onClick={()=>{setMapping(null);setEditor(variant);setAmount((variant.retail_cents/100).toFixed(2));setReason('');}}>Edit variant price</button></div>}
   </article>)}</div>
   {mapping&&<form className="ka-form ka-variant" onSubmit={e=>{e.preventDefault();run(saveMapping);}}>
    <h3>Verify {mapping.label}</h3>
    <p>Save a draft mapping and verified costs where available. This does not enable checkout or submit an order.</p>
    <fieldset disabled={busy}><legend>Supplier configuration</legend><div className="ka-book-fields">{mappingFields.concat([['reason','Reason']]).map(([key,label])=><label key={key}>{label}<input required={key!=='coverMaterial'} type={key==='pageCount'?'number':'text'} min={key==='pageCount'?1:undefined} max={key==='pageCount'?1000:undefined} minLength={key==='reason'?10:undefined} maxLength={key==='reason'?1000:400} value={mappingValues[key]??''} onChange={e=>setMappingValues(value=>({...value,[key]:e.target.value}))}/></label>)}</div></fieldset>
    <div className="ka-actions"><button disabled={busy}>Check and save draft mapping</button><button disabled={busy} type="button" onClick={()=>setMapping(null)}>Cancel</button></div>
   </form>}
   {editor&&<form className="ka-form ka-variant" onSubmit={e=>{e.preventDefault();run(savePrice);}}>
    <h3>{editor.label}</h3><label>Retail price USD<input type="number" min=".01" max="10000" step=".01" required disabled={busy} value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Reason<input required disabled={busy} minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <div className="ka-actions"><button disabled={busy}>Save future price</button><button disabled={busy} type="button" onClick={()=>setEditor(null)}>Cancel</button></div>
   </form>}
   <h3>Book drafts and proof queue ({data.drafts.length})</h3>
   {data.drafts.length?data.drafts.map(draft=><details key={draft.id}><summary>{draft.label} · {draft.audience} · {draft.status} · revision {draft.revision}</summary><p>{draft.books.length} book(s) · {draft.books.reduce((n,book)=>n+book.photos.length,0)} different photos · {draft.books.reduce((n,book)=>n+book.copies,0)} copies · {draft.approved_at?'Proof approved':'Awaiting final proof'}</p><p>Draft ID: {draft.id}</p></details>):<p>No book drafts yet. Drafts are not paid orders or revenue.</p>}
  </>}
 </section>;
}
