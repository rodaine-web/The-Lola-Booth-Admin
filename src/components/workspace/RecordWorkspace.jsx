import { InsightPanel, Bars, Ring, ActivityList, MiniCalendar, groupRecords } from './InsightPanels.jsx';
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
 if(rows.length&&!rows.some(row=>row[field]))return null;
 const groups=Object.entries(rows.reduce((acc,row)=>{const key=row[field]?labelize(row[field]):'Unspecified';acc[key]=(acc[key]||0)+1;return acc;},{})).sort((a,b)=>b[1]-a[1]).slice(0,6);
 return <article className="record-panel"><h2>{title}</h2>{groups.length?<div className="record-distribution">{groups.map(([name,value])=><div key={name}><span>{name}</span><div className="record-bar"><i style={{width:`${value/rows.length*100}%`}}/></div><strong>{value}</strong></div>)}</div>:<p className="record-muted">No records in this view.</p>}</article>;
}
export function RecordMetrics({module,rows}){const icons=[Users,CalendarDays,CheckCircle2,BarChart3];return <><section className="record-metrics" aria-label={`${module} summary`}>{workspaceSummary(module,rows).map(([label,value],i)=>{const Icon=icons[i];return <article key={label}><span className="record-metric-icon"><Icon size={25}/></span><div><strong>{value}</strong><span>{label}</span></div></article>;})}</section><p className="record-scope">Summaries reflect the records loaded in this view and current filters.</p></>;}
export default function RecordWorkspace({module,rows=[],getRowHref,children}){
 const today=businessToday();
 const [field,title,second,secondTitle]=grouping[module]||grouping.Messages;
 const recent=[...rows].sort((a,b)=>String(b.updated_at||b.created_at||b.sent_at||'').localeCompare(String(a.updated_at||a.created_at||a.sent_at||'')));
 const upcoming=rows.filter(row=>dateKey(row.event_date||row.due_date||row.scheduled_at)>=today).sort((a,b)=>String(a.event_date||a.due_date||a.scheduled_at).localeCompare(String(b.event_date||b.due_date||b.scheduled_at)));
 const statuses=groupRecords(rows,'status');
 const panel=(name,content,link)=><InsightPanel title={name} link={link}>{content}</InsightPanel>;
 let panels;
 switch(module){
 case 'Events': panels=<>{panel('Event Calendar Snapshot',<MiniCalendar rows={rows}/>, '/events/calendar')}{panel('Event Type Mix',<Ring data={groupRecords(rows,'event_type')} centre={rows.length} label="events"/>)}{panel('Upcoming Schedule',<ActivityList rows={upcoming} getRowHref={getRowHref}/>, '/events/events')}</>;break;
 case 'Tasks': panels=<>{panel('Task Status Breakdown',<Ring data={statuses} centre={rows.length} label="tasks"/>)}{panel('Team Workload',<Bars data={groupRecords(rows.filter(row=>!['DONE','CANCELLED'].includes(row.status)),'owner_name')}/>)}{panel("Today's Agenda",<ActivityList rows={rows.filter(row=>dateKey(row.due_date)===today)} dateField="due_date" getRowHref={getRowHref}/>, '/events/calendar')}</>;break;
 case 'Leads': panels=<>{panel('Lead Pipeline',<Bars data={statuses} vertical/>)}{panel('Leads by Source',<Bars data={groupRecords(rows,'lead_source')} percent/>)}{panel('Upcoming Follow-ups',<ActivityList rows={rows.filter(row=>dateKey(row.next_follow_up_at||row.follow_up_date)>=today).map(row=>({...row,due_date:row.next_follow_up_at||row.follow_up_date}))} dateField="due_date" getRowHref={row=>'/sales/leads/'+row.id}/>, '/operations/tasks')}</>;break;
 case 'Clients': panels=<>{panel('Client Segments',<Bars data={groupRecords(rows,'client_type')} vertical/>)}{panel('Recent Activity',<ActivityList rows={recent} getRowHref={row=>'/sales/clients/'+row.id}/>)}{panel('Upcoming Touchpoints',<ActivityList rows={upcoming}/>, '/operations/tasks')}</>;break;
 case 'Proposals': panels=<>{panel('Proposal Pipeline',<Bars data={statuses} vertical/>)}{panel('Approval Rate',<Ring data={[{name:'Accepted',value:rows.filter(row=>['ACCEPTED','CONVERTED'].includes(row.status)).length},{name:'Other',value:rows.filter(row=>!['ACCEPTED','CONVERTED'].includes(row.status)).length}]} centre={rows.length?Math.round(rows.filter(row=>['ACCEPTED','CONVERTED'].includes(row.status)).length/rows.length*100)+'%':'—'} label="of loaded proposals"/>)}{panel('Recent Activity',<ActivityList rows={recent} getRowHref={row=>'/sales/proposals/'+row.id}/>)}</>;break;
 case 'Invoices': { const aged=[['Current',0,30],['31–60 Days',31,60],['61–90 Days',61,90],['90+ Days',91,Infinity]].map(([name,min,max])=>({name,value:rows.filter(row=>Number(row.amount_outstanding)>0&&row.due_date&&Math.max(0,Math.floor((new Date(today)-new Date(row.due_date))/86400000))>=min&&Math.max(0,Math.floor((new Date(today)-new Date(row.due_date))/86400000))<=max).length}));panels=<>{panel('Invoice Aging',<Bars data={aged} vertical/>)}{panel('Payment Status Mix',<Ring data={statuses} centre={rows.length} label="invoices"/>)}{panel('Upcoming Due Dates',<ActivityList rows={upcoming.filter(row=>Number(row.amount_outstanding)>0)} dateField="due_date" money getRowHref={row=>'/finance/invoices/'+row.id}/>, '/finance/invoices')}</>;break;}
 case 'Payments': panels=<>{panel('Payment Methods Breakdown',<Ring data={groupRecords(rows,'provider')} centre={formatMoney(numeric(rows.filter(row=>row.status==='SUCCEEDED'),'amount'))} label="collected"/>)}{panel('Recent Transactions',<ActivityList rows={recent} money getRowHref={row=>'/finance/payments/'+row.id}/>)}{panel('Payment Status',<Bars data={statuses}/>)}</>;break;
 case 'Templates': panels=<>{panel('Most Used Templates',<ActivityList rows={[...rows].filter(row=>row.usage_count!=null||row.used_count!=null).sort((a,b)=>Number(b.usage_count||b.used_count||0)-Number(a.usage_count||a.used_count||0))}/>)}{panel('Recent Edits',<ActivityList rows={recent}/>)}{panel('Template Categories',<Ring data={groupRecords(rows,'category')} centre={rows.length} label="templates"/>)}</>;break;
 case 'Scheduled': panels=<>{panel('Upcoming Sends',<ActivityList rows={upcoming} dateField="scheduled_at"/>)}{panel('Send Volume by Day',<Bars data={groupRecords(rows.map(row=>({...row,day:dateKey(row.scheduled_at)})),'day')} vertical/>)}{panel('Approval Queue',<ActivityList rows={rows.filter(row=>row.requires_approval||row.status==='PENDING_APPROVAL')}/>)}</>;break;
 case 'Messages': panels=<>{panel('Recent Activity',<ActivityList rows={recent}/>)}{panel('Channel Mix',<Ring data={groupRecords(rows,'channel')} centre={rows.length} label="messages"/>)}{panel('Follow-ups Due',<ActivityList rows={rows.filter(row=>row.status==='AWAITING_REPLY')}/>, '/operations/tasks')}</>;break;
 default: panels=<>{panel(title,<Bars data={groupRecords(rows,field)}/>)}{panel(secondTitle,<Ring data={groupRecords(rows,second)} centre={rows.length} label="workflows"/>)}{panel('Recent Activity',<ActivityList rows={recent}/>)}</>;
 }
 return <div className="record-workspace"><div className="record-content">{children}</div><aside className="record-rail" aria-label={`${module} insights`}>{panels}</aside></div>;
}
