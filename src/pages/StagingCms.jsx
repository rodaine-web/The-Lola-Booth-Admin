import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
import AsyncState from '../components/AsyncState.jsx';
import {useDialogFocus} from '../utils/use-dialog-focus.js';
const aliases={homepage:'content',events:'eventTypes',pageItems:'pageItems',mediaMappings:'media'};
const fields={
 pageItems:[['page_slug','Page'],['slot_key','Page slot'],['html','Visible copy','textarea'],['href','Link']],
 hero:[['alt_text','Image description'],['caption','Caption'],['image','Image','image'],['fallback_image','Approved fallback','image']],
 experiences:[['name','Name'],['website_name','Website name'],['slug','Slug'],['website_heading','Heading'],['website_kicker','Supporting line'],['website_label','Label'],['website_short_description','Homepage description','textarea'],['website_long_description','Full description','textarea'],['features','Features (one per line)','lines'],['image','Image','image']],
 packages:[['name','Name'],['website_key','Package identity'],['pricing_mode','Pricing mode','pricing'],['starting_price','Starting price','number'],['website_short_description','Description','textarea'],['website_home_description','Homepage description','textarea'],['website_custom_heading','Custom heading'],['website_features','Features (one per line)','lines'],['image','Image','image']],
 eventTypes:[['name','Name'],['slug','Slug'],['short_description','Description','textarea'],['home_description','Homepage description','textarea'],['image','Image','image']],
 gallery:[['title','Title'],['caption','Caption','textarea'],['alt_text','Image description'],['category','Category'],['image','Image','image'],['fallback_image','Approved fallback','image']],
 testimonials:[['client_display_name','Client display name'],['event_type','Event type'],['quote','Quote','textarea'],['rating','Rating','number'],['client_photo','Photo','image']],
 faqs:[['question','Question'],['answer','Answer','textarea'],['category','Category']],
 content:[['content_key','Page key'],['title','Page title'],['seo_title','SEO title'],['seo_description','SEO description','textarea']],
 settings:[['value','Value','setting']],
 media:[['title','Title'],['alt_text','Image description'],['url','Approved asset URL'],['filename','Filename']]
};
const titles={pageItems:'Page Items',hero:'Hero Slides',experiences:'Experiences',packages:'Packages',eventTypes:'Event Types',gallery:'Gallery',testimonials:'Testimonials',faqs:'FAQs',content:'Page SEO',settings:'Site Settings & Social Links',media:'Media Library'};
export default function StagingCms({section}){
 const type=aliases[section]||section,{can}=useAuth();
 const [rows,setRows]=useState(null),[media,setMedia]=useState([]),[editing,setEditing]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false);
 useDialogFocus(Boolean(editing),()=>setEditing(null));
 async function load(){setError('');try{const [r,m]=await Promise.all([api.get('/website/staging/'+type),api.get('/website/staging/media')]);setRows(r.data);setMedia(m.data.filter(x=>x.status==='PUBLISHED'));}catch(e){setError(e.message);}}
 useEffect(()=>{setRows(null);setEditing(null);setSearch('');load();},[type]);
 function edit(row){setEditing(row?{...row,payload:{...row.payload}}:{entity_key:'',payload:{},status:'DRAFT',display_order:rows?.length+1||1,channel:'STAGING'});}
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{const body={...editing,channel:'STAGING'};if(editing.id)await api.patch(`/website/staging/${type}/${editing.id}`,body);else await api.post(`/website/staging/${type}`,body);setEditing(null);setNotice('Saved to STAGING. Public website unchanged.');await load();}catch(err){setError(err.message);}finally{setBusy(false);}}
 async function action(row,act){if(busy)return;setBusy(true);try{await api.post(`/website/staging/${type}/${row.id}/${act}`,{});setNotice(`${act==='unpublish'?'Unpublished':act==='publish'?'Published':'Archived'} in STAGING only.`);await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function upload(file){if(!file||busy)return;setBusy(true);try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});await api.post('/website/staging/upload',{filename:file.name,mimeType:file.type,data});setNotice('Uploaded to staging media.');await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const visible=(rows||[]).filter(r=>JSON.stringify(r.payload).toLowerCase().includes(search.toLowerCase())||r.entity_key.includes(search));
 return <main className="page cms-workspace"><div className="page-heading lola-page-heading"><div><p className="eyebrow">Website CMS · STAGING</p><h1>{titles[type]||type}</h1><p className="lede">Update staging website content visually while keeping public V1 unchanged.</p></div><div className="button-row"><a className="lola-secondary-button" href="https://staging.thelolabooth.com" target="_blank" rel="noreferrer">Open staging website ↗</a>{can('write:website')&&<button className="primary-action" onClick={()=>edit(null)}>Add record</button>}</div></div><nav className="cms-section-nav">{[["homepage","Homepage"],["hero-slides","Hero Slides"],["experiences","Experiences"],["packages","Packages"],["events","Event Types"],["gallery","Gallery"],["testimonials","Testimonials"],["faq","FAQs"],["media-library","Media"],["site-settings","Site Settings"]].map(([path,label])=><Link className={section===path?"active":""} key={path} to={"/website/"+path}>{label}</Link>)}</nav>
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
 <label>Search staging records<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
 {type==='media'&&can('write:website')&&<label>Upload staging image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>upload(e.target.files[0])}/></label>}
 <AsyncState loading={rows===null} error={error} onRetry={load} noun="staging content">
 {isVisualType(type)?<div className="cms-visual-grid">{visible.map(row=><article className="cms-visual-card" key={row.id} data-cms-record-id={row.id}>
   <div className="cms-visual-media">{recordImage(row)?<img src={recordImage(row)} alt={row.payload.alt_text||row.payload.name||row.payload.title||"Website content"}/>:<div className="cms-media-placeholder">LOLA</div>}</div>
   <div className="cms-visual-copy"><div className="cms-card-heading"><div><strong>{recordLabel(row)}</strong><small>{row.entity_key}</small></div><span className={"cms-state "+String(row.status||"").toLowerCase()}>{row.status}</span></div>
   <p>{recordDescription(row)}</p><div className="cms-card-meta"><span>Order {row.display_order}</span><span>STAGING</span></div>
   <div className="button-row">{can('write:website')&&<button onClick={()=>edit(row)}>Edit</button>}{can('publish:website')&&<><button disabled={busy} onClick={()=>action(row,row.status==='PUBLISHED'?'unpublish':'publish')}>{row.status==='PUBLISHED'?'Unpublish':'Publish'}</button><button disabled={busy} onClick={()=>action(row,'archive')}>Archive</button></>}</div></div>
 </article>)}</div>:<div className="table-wrap"><table><thead><tr><th>Record</th><th>Channel</th><th>State</th><th>Order</th><th>Actions</th></tr></thead><tbody>{visible.map(row=><tr key={row.id} data-cms-record-id={row.id}><td><strong>{recordLabel(row)}</strong><small style={{display:'block'}}>{row.entity_key}</small></td><td><span className="environment-badge">STAGING</span></td><td>{row.status}</td><td>{row.display_order}</td><td>{can('write:website')&&<button onClick={()=>edit(row)}>Edit</button>}{can('publish:website')&&<><button disabled={busy} onClick={()=>action(row,row.status==='PUBLISHED'?'unpublish':'publish')}>{row.status==='PUBLISHED'?'Unpublish':'Publish'}</button><button disabled={busy} onClick={()=>action(row,'archive')}>Archive</button></>}</td></tr>)}</tbody></table></div>}
 </AsyncState>
 {editing&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Edit staging record"><h2>{editing.id?'Edit':'Create'} staging record</h2><p>Channel: <strong>STAGING</strong> · Current state: {editing.status}</p><form onSubmit={save}><label>Record key<input required value={editing.entity_key} onChange={e=>setEditing({...editing,entity_key:e.target.value})}/></label>
 {(fields[type]||[]).map(([key,label,kind])=>{const value=editing.payload[key];const change=v=>setEditing({...editing,payload:{...editing.payload,[key]:v}});return <label key={key}>{label}{kind==='image'?<select value={value||''} onChange={e=>change(e.target.value)}><option value="">Use approved fallback</option>{value&&!media.some(m=>m.payload.url===value)&&<option value={value}>Current image</option>}{media.map(m=><option key={m.id} value={m.payload.url}>{m.payload.title||m.entity_key}</option>)}</select>:kind==='pricing'?<select value={value||'STARTING'} onChange={e=>change(e.target.value)}><option>STARTING</option><option>CUSTOM</option></select>:kind==='setting'&&typeof value==='boolean'?<input type="checkbox" checked={value} onChange={e=>change(e.target.checked)}/>:kind==='textarea'||kind==='lines'?<textarea value={Array.isArray(value)?value.join('\n'):value||''} onChange={e=>change(kind==='lines'?e.target.value.split('\n'):e.target.value)}/>:<input type={kind==='number'?'number':'text'} value={value??''} onChange={e=>change(kind==='number'?(e.target.value===''?null:Number(e.target.value)):e.target.value)}/>}</label>;})}
 <label>Sort order<input type="number" value={editing.display_order} onChange={e=>setEditing({...editing,display_order:Number(e.target.value)})}/></label><div className="form-actions"><button type="button" onClick={()=>setEditing(null)}>Cancel</button><button disabled={busy} type="submit">{busy?'Saving…':'Save staging record'}</button></div></form></section></div>}
 </main>;
}

function isVisualType(type){return["hero","experiences","packages","eventTypes","gallery","testimonials","media"].includes(type);}
function recordImage(row){const p=row?.payload||{};return p.image||p.fallback_image||p.url||p.client_photo||null;}
function recordLabel(row){const p=row?.payload||{};return p.name||p.website_name||p.title||p.question||p.client_display_name||p.content_key||row.entity_key;}
function recordDescription(row){const p=row?.payload||{};return p.website_short_description||p.short_description||p.caption||p.quote||p.alt_text||p.home_description||"";}
