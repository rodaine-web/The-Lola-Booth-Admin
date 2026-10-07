import { BarChart3, CalendarDays, CheckCircle2, FileText, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { businessToday, formatMoney, formatTimestamp, labelize } from '../../utils/display.js';
import '../../styles/record-workspace.css';

const dateKey=value=>!value?'':/^\d{4}-\d{2}-\d{2}$/.test(String(value))?String(value):Number.isFinite(new Date(value).getTime())?businessToday(new Date(value)):'';
const numeric=(rows,key)=>rows.reduce((sum,row)=>sum+(Number(row[key])||0),0);
const count=(rows,values)=>rows.filter(row=>values.includes(row.status)).length;
export function workspaceSummary(module, rows=[]){
 const today=businessToday();
 const upcoming=rows.filter(r=>dateKey(r.event_date||r.due_date||r.scheduled_at||r.scheduled_for)>=today).length;
 const groups=key=>new Set(rows.map(r=>r[key]).filter(Boolean)).size;
 switch(module){
 case 'Proposals': return [['Proposals loaded',rows.length],['Sent / viewed',count(rows,['SENT','VIEWED'])],['Accepted / converted',count(rows,['ACCEPTED','CONVERTED'])],['Open proposal value',formatMoney(numeric(rows.filter(r=>['DRAFT','READY','SENT','VIEWED'].includes(r.status)),'total'))]];
 case 'Invoices': return [['Outstanding balance',formatMoney(numeric(rows.filter(r=>!['VOID','REFUNDED'].includes(r.status)),'amount_outstanding'))],['Paid invoices',count(rows,['PAID'])],['Overdue invoices',count(rows,['OVERDUE'])],['Invoices loaded',rows.length]];
 case 'Payments': return [['Successful payments',formatMoney(numeric(rows.filter(r=>r.status==='SUCCEEDED'),'amount'))],['Processing',count(rows,['PROCESSING'])],['Failed payments',count(rows,['FAILED'])],['Payments loaded',rows.length]];
 case 'Leads': return [['Leads loaded',rows.length],['New inquiries',count(rows,['NEW'])],['Qualified / follow-up',count(rows,['QUALIFIED','FOLLOW_UP'])],['Won leads',count(rows,['WON'])]];
 case 'Clients': return [['Clients loaded',rows.length],['Companies',groups('company')],['Client types',groups('client_type')],['With phone details',rows.filter(r=>r.phone).length]];
 case 'Events': return [['Upcoming events',upcoming],['Confirmed',count(rows,['CONFIRMED'])],['Ready to go',count(rows,['READY'])],['Events loaded',rows.length]];
 case 'Tasks': return [['Open tasks',count(rows,['OPEN','IN_PROGRESS'])],['Due today',rows.filter(r=>String(r.due_date||'').slice(0,10)===today&&!['DONE','CANCELLED'].includes(r.status)).length],['Completed',count(rows,['DONE'])],['Overdue',rows.filter(r=>r.due_date&&String(r.due_date).slice(0,10)<today&&!['DONE','CANCELLED'].includes(r.status)).length]];
 case 'Content': return [['Records loaded',rows.length],['Published / active',rows.filter(r=>r.status==='PUBLISHED'||r.active===true).length],['Draft records',count(rows,['DRAFT'])],['Archived / inactive',rows.filter(r=>r.status==='ARCHIVED'||r.active===false).length]];
 case 'Staff': return [['Team members',rows.length],['Active members',rows.filter(r=>r.active).length],['Team roles',groups('role')],['With contact email',rows.filter(r=>r.email).length]];
 case 'Equipment': return [['Equipment loaded',rows.length],['Available',count(rows,['AVAILABLE'])],['In use / reserved',count(rows,['IN_USE','RESERVED'])],['Maintenance',count(rows,['MAINTENANCE'])]];
 case 'Templates': return [['Templates loaded',rows.length],['Active templates',rows.filter(r=>r.status==='ACTIVE'||r.active===true).length],['Draft templates',count(rows,['DRAFT'])],['Channels',groups('channel')]];
 case 'Automations': return [['Automation rules',rows.length],['Enabled rules',rows.filter(r=>r.enabled).length],['Paused rules',rows.filter(r=>!r.enabled).length],['Trigger types',groups('trigger_key')]];
 case 'Scheduled': return [['Scheduled sends',rows.length],['Sending today',rows.filter(r=>dateKey(r.scheduled_at)===today).length],['Email sends',rows.filter(r=>r.channel==='EMAIL').length],['SMS sends',rows.filter(r=>r.channel==='SMS').length]];
 default:return [['Messages loaded',rows.length],['Sent to provider',count(rows,['SENT_TO_PROVIDER'])],['Scheduled',count(rows,['SCHEDULED'])],['Failed',count(rows,['FAILED'])]];
 }
}
const grouping={Leads:['status','Lead pipeline','source','Leads by source'],Clients:['client_type','Client segments','company','Companies'],Events:['status','Event readiness','event_type','Event type mix'],Tasks:['status','Task status breakdown','owner_name','Team workload'],Proposals:['status','Proposal pipeline','event_type','Event types'],Invoices:['status','Payment status mix','client_name','Balances by client'],Payments:['provider','Payment providers','status','Payment status'],Templates:['category','Template categories','channel','Channels'],Scheduled:['channel','Send channels','status','Send status'],Messages:['channel','Channel mix','status','Message status'],Automations:['trigger_key','Workflow triggers','action_type','Workflow actions']};
function Distribution({rows,field,title}){
 const groups=Object.entries(rows.reduce((acc,row)=>{const key=row[field]?labelize(row[field]):'Unspecified';acc[key]=(acc[key]||0)+1;return acc;},{})).sort((a,b)=>b[1]-a[1]).slice(0,6);
 return <article className="record-panel"><h2>{title}</h2>{groups.length?<div className="record-distribution">{groups.map(([name,value])=><div key={name}><span>{name}</span><div className="record-bar"><i style={{width:`${value/rows.length*100}%`}}/></div><strong>{value}</strong></div>)}</div>:<p className="record-muted">No records in this view.</p>}</article>;
}
export function RecordMetrics({module,rows}){const icons=[Users,CalendarDays,CheckCircle2,BarChart3];return <><section className="record-metrics" aria-label={`${module} summary`}>{workspaceSummary(module,rows).map(([label,value],i)=>{const Icon=icons[i];return <article key={label}><span className="record-metric-icon"><Icon size={25}/></span><div><strong>{value}</strong><span>{label}</span></div></article>;})}</section><p className="record-scope">Summaries reflect the records loaded in this view and current filters.</p></>;}
export default function RecordWorkspace({module,rows=[],getRowHref,children}){
 const [field,title,second,secondTitle]=grouping[module]||grouping.Messages;
 const recent=[...rows].sort((a,b)=>String(b.updated_at||b.created_at||b.sent_at||'').localeCompare(String(a.updated_at||a.created_at||a.sent_at||''))).slice(0,5);
 return <div className="record-workspace"><div className="record-content">{children}</div><aside className="record-rail"><Distribution rows={rows} field={field} title={title}/><Distribution rows={rows} field={second} title={secondTitle}/><article className="record-panel"><h2>{['Events','Tasks','Scheduled'].includes(module)?'Dates & activity':'Recent records'}</h2><div className="record-activity">{recent.map(row=>{const label=row.name||row.title||row.event_name||row.proposal_number||row.invoice_number||row.rendered_subject||row.recipient||row.reference_number||'Record';return <div key={row.id}><span className="record-small-icon"><FileText size={16}/></span><div>{getRowHref?<Link to={getRowHref(row)}>{label}</Link>:<strong>{label}</strong>}<small>{row.event_date||row.due_date||((row.updated_at||row.created_at||row.scheduled_at)&&formatTimestamp(row.updated_at||row.created_at||row.scheduled_at))||'Date not recorded'}</small></div></div>;})}{!recent.length&&<p className="record-muted">Activity will appear here as records are added.</p>}</div></article></aside></div>;
}
