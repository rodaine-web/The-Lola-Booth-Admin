import {useEffect,useMemo,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {Building2,CalendarDays,CheckCircle2,BarChart3,Search,SlidersHorizontal,Plus,ArrowRight,Users,Clock3} from 'lucide-react';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
import {RecordEditDialog} from '../components/RecordDashboard.jsx';
import '../styles/partner-parity.css';

const dateLabel=v=>v?new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
export default function PartnerDirectory(){
 const navigate=useNavigate();const {can}=useAuth();
 const [items,setItems]=useState([]),[status,setStatus]=useState('ACTIVE'),[search,setSearch]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[showFilters,setShowFilters]=useState(true),[page,setPage]=useState(1),[creating,setCreating]=useState(false);
 useEffect(()=>{let alive=true;setLoading(true);setError('');const q=new URLSearchParams({status,search:search.trim()});api.get(`/partners?${q}`).then(r=>{if(alive)setItems(r.data||[])}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[status,search]);
 useEffect(()=>setPage(1),[status,search]);
 const rows=useMemo(()=>items.slice((page-1)*12,page*12),[items,page]);
 const active=items.filter(x=>x.status==='ACTIVE').length;
 const archived=items.filter(x=>x.status==='ARCHIVED').length;
 const withEmail=items.filter(x=>Boolean(x.email)).length;
 const withContact=items.filter(x=>Boolean(x.contact_name)).length;
 return <main className="page ppar-directory" aria-labelledby="ppar-directory-title">
  <header className="ppar-list-heading"><div><h1 id="ppar-directory-title">Partners</h1><p>Manage relationships and keep every partner organized.</p></div><div className="ppar-button-row"><button type="button" onClick={()=>setShowFilters(v=>!v)}><SlidersHorizontal size={15}/> Filters</button>{can('write:sales')&&<button className="ppar-gold-button" type="button" onClick={()=>setCreating(true)}><Plus size={15}/> New Partner</button>}</div></header>
  <section className="ppar-stats" aria-label="Partner directory summary">{[[Users,items.length,'Partners loaded'],[Building2,withContact,'With primary contacts'],[CheckCircle2,active,'Active in view'],[BarChart3,withEmail,'With email details']].map(([Icon,value,label])=><div key={label} className="ppar-stat"><span className="ppar-stat-icon"><Icon size={19}/></span><strong>{value}</strong><small>{label}</small></div>)}</section>
  <p className="ppar-disclaimer">Summaries reflect the records loaded in this view and current filters.</p>
  <div className="ppar-status-filter"><label htmlFor="ppar-status">Activity</label><select id="ppar-status" value={status} onChange={e=>setStatus(e.target.value)}><option value="ACTIVE">Active partners</option><option value="ARCHIVED">Archived partners</option><option value="ALL">All partners</option></select></div>
  {showFilters&&<section className="ppar-filterbar"><label><span>Search</span><div className="ppar-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search partners by name, number or email" aria-label="Search partners"/></div></label><label><span>Partner status</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option><option value="ALL">All statuses</option></select></label></section>}
  {error&&<p role="alert" className="toast error">{error} <button onClick={()=>setStatus('ALL')}>Try all partners</button></p>}
  <div className="ppar-list-grid">
   <section className="ppar-table-card"><div className="ppar-table-heading"><h2>Partners ({items.length})</h2><div className="ppar-button-row"><Link to="/sales/leads?opportunity_type=PARTNERSHIP">Partnership opportunities <ArrowRight size={13}/></Link></div></div>
   <div className="ppar-table-scroll"><table><thead><tr><th>Partner</th><th>Activity status</th><th>Primary contact</th><th>Email</th><th>Phone</th><th>Updated at</th><th aria-label="View partner"></th></tr></thead><tbody>
   {rows.map(p=><tr key={p.id} onClick={()=>navigate(`/sales/partners/${p.id}`)}><td><Link to={`/sales/partners/${p.id}`} className="ppar-name">{p.name}</Link><small>{p.partner_number||'Partner record'}</small></td><td><span className={`ppar-chip ${p.status==='ACTIVE'?'active':'inactive'}`}>{p.status==='ACTIVE'?'Active':'Archived'}</span></td><td>{p.contact_name||'—'}</td><td>{p.email||'—'}</td><td>{p.phone||'—'}</td><td>{dateLabel(p.updated_at)}</td><td><Link aria-label={`Open ${p.name}`} to={`/sales/partners/${p.id}`}>•••</Link></td></tr>)}
   {!loading&&!rows.length&&<tr><td colSpan={7} className="ppar-no-data">No partners match these filters.</td></tr>}{loading&&<tr><td colSpan={7} className="ppar-no-data">Loading partners…</td></tr>}
   </tbody></table></div>
   <footer className="ppar-footer"><small>Showing {rows.length?((page-1)*12+1):0}–{Math.min(page*12,items.length)} of {items.length} loaded records</small><div><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>‹</button><span>{page}</span><button disabled={page*12>=items.length} onClick={()=>setPage(p=>p+1)}>›</button></div></footer>
   </section>
   <aside className="ppar-side"><section className="ppar-side-card"><h2>Partner Segments</h2><div className="ppar-mini-chart"><div><div className="ppar-bar" style={{height:`${Math.max(5,(active/Math.max(1,items.length))*95)}px`}}/><small>ACTIVE</small><strong>{active}</strong></div><div><div className="ppar-bar muted" style={{height:`${Math.max(5,(archived/Math.max(1,items.length))*95)}px`}}/><small>ARCHIVED</small><strong>{archived}</strong></div></div></section><section className="ppar-side-card"><h2>Recently Updated</h2>{items.slice(0,4).map(p=><Link className="ppar-activity" key={p.id} to={`/sales/partners/${p.id}`}><span className="ppar-activity-icon"><CalendarDays size={15}/></span><span><strong>{p.name}</strong><small>{dateLabel(p.updated_at)}</small></span></Link>)}{!items.length&&<p>No partner activity in this view.</p>}</section><section className="ppar-side-card"><h2>Next Steps</h2><p>Open a partner record to manage associated events and optional workspace invitations.</p></section></aside>
  </div>
  {creating&&<RecordEditDialog title="New Partner" record={{status:'ACTIVE'}} fields={[{key:'name',label:'Organization / partner name',required:true},{key:'contact_name',label:'Contact name'},{key:'email',label:'Email',type:'email'},{key:'phone',label:'Phone'},{key:'website',label:'Website',type:'url'},{key:'notes',label:'Internal notes',type:'textarea'}]} onSave={async values=>{try{const row=await api.post('/partners',values);setCreating(false);navigate(`/sales/partners/${row.id}`)}catch(e){setError(e.message)}}} onClose={()=>setCreating(false)}/>}
 </main>
}
