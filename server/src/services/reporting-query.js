import {query} from '../db/pool.js';
// Trusted application SQL only. All operational reporting consumes the same explicit data scope.
export function reportingSql(sql){return sql.replace(/\b(FROM|JOIN)\s+(leads|clients|events|bookings|proposals|invoices|payments|tasks)\b/gi,(_,operation,table)=>`${operation} reporting_${table.toLowerCase()}`);}
export function reportingQuery(sql,values){return query(reportingSql(sql),values);}
