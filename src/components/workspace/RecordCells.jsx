import { formatDisplay } from '../../utils/display.js';
export function PersonCell({name,email,detail}){return <div className="record-cell-primary"><strong>{name||'—'}</strong>{(email||detail)&&<small>{email||detail}</small>}</div>;}
export function OwnerCell({name}){return name?<span className="record-owner"><span className="record-avatar">{name.split(' ').filter(Boolean).slice(0,2).map(part=>part[0]).join('')}</span>{name}</span>:'—';}
export function recordCell(row,column){
 if(column==='name')return <PersonCell name={row.name} email={row.email} detail={row.short_description||row.description}/>;
 if(['title','event_name','proposal_number','invoice_number'].includes(column))return <PersonCell name={row[column]} detail={column==='title'?row.description:null}/>;
 if(['owner_name','assigned_to_name','account_manager'].includes(column))return <OwnerCell name={row[column]}/>;
 if(column==='client_name')return <PersonCell name={row.client_name} detail={row.client_email}/>;
 if(column==='related_to')return <PersonCell name={row.client_name||row.event_name||'Internal'} detail={row.client_name?row.event_name:null}/>;
 if(column==='priority')return <span className={`record-priority priority-${String(row.priority||'').toLowerCase()}`}>{formatDisplay(row.priority,'priority')}</span>;
 return undefined;
}
