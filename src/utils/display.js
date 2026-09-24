const missing = value => value === null || value === undefined || value === '';
export const BUSINESS_TIME_ZONE = 'America/Chicago';
export function labelize(value) { return String(value || '').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()); }
export function formatMoney(value, currency='USD') { return missing(value)||!Number.isFinite(Number(value))?'—':new Intl.NumberFormat('en-US',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)); }
export function formatCount(value) { return missing(value)||!Number.isFinite(Number(value))?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(Number(value)); }
export function formatPercent(value) { return missing(value)||!Number.isFinite(Number(value))?'—':`${new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(Number(value))}%`; }
// Date-only fields retain calendar components. UTC is used solely as a formatting calendar.
export function formatDateOnly(value, options={}) {
 if(missing(value))return '—';
 const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);if(!match)return '—';
 const [,year,month,day]=match;const calendar=new Date(Date.UTC(+year,+month-1,+day));
 if(calendar.getUTCFullYear()!==+year||calendar.getUTCMonth()!==+month-1||calendar.getUTCDate()!==+day)return '—';
 return new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',...options,timeZone:'UTC'}).format(calendar);
}
export function formatTimestamp(value,options={}) {
 if(missing(value))return '—';const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';
 return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone:BUSINESS_TIME_ZONE,...options}).format(date);
}
export const formatBusinessDateTime = (value,options={}) => formatTimestamp(value,{...options,timeZone:BUSINESS_TIME_ZONE});
export function businessToday(now=new Date()) { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:BUSINESS_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-'); }
export function statusTone(status) {
 const key=String(status||'').toUpperCase();
 if(['HEALTHY','COMPLETE','COMPLETED','PAID','READY','AVAILABLE','SUCCESS','SUCCESSFUL','CONNECTED','ACTIVE','PUBLISHED','SENT_TO_PROVIDER','ACCEPTED'].includes(key))return 'success';
 if(['FAILED','ERROR','OVERDUE','BLOCKED','INCIDENT','UNHEALTHY','CONFLICT','OUT_OF_SERVICE','DOWN','ISSUE_REPORTED'].includes(key))return 'danger';
 if(['WARNING','ATTENTION','NEEDS_ATTENTION','PARTIAL','PENDING','INVITED','DUE_SOON','NOT_READY','RESERVED','NEEDS_CHECK','DEGRADED','STALE','PENDING_APPROVAL','SCHEDULED'].includes(key))return 'warning';
 if(['NEW','IN_PROGRESS','CONFIRMED','SENT','VIEWED','EN_ROUTE','ON_SITE','SETTING_UP','LIVE'].includes(key))return 'info';
 return 'neutral';
}
const moneyFields=/^(amount|price|base_price|starting_price|hourly_rate|unit_price|total|subtotal|tax|discount|deposit|deposit_amount|balance|balance_due|amount_paid|amount_outstanding|amount_due|revenue|revenue_booked|revenue_collected|booked_revenue|collected_revenue|outstanding_balance|average_booking_value|lifetime_value|line_total)$/;
export function formatDisplay(value,field='') {
 if(missing(value))return ['proposal_number','invoice_number','event_number'].includes(field)?'Legacy record · number missing':'—';
 if(typeof value==='boolean')return value?'Yes':'No';
 if(moneyFields.test(field))return formatMoney(value);
 if(/(^|_)(percent|percentage|conversion_rate|tax_rate)$/.test(field))return formatPercent(value);
 if(/(_date|valid_through)$/.test(field))return formatDateOnly(value);
 if(/(_at|scheduled_for)$/.test(field))return formatTimestamp(value);
 if(/^(status|priority|channel|direction|invitation_status|operational_status)$/.test(field))return labelize(value);
 if(typeof value==='number')return new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value);
 if(typeof value==='object')return 'Details available';
 return String(value);
}
