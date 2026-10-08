import { Link } from 'react-router-dom';
import { CalendarDays, FileText, Mail, CheckCircle2 } from 'lucide-react';
import { businessToday, formatDateOnly, formatMoney, labelize } from '../../utils/display.js';

import {chartColours} from '../../../shared/admin-appearance.js';
export {chartColours};
export const rowName = row => row.name || [row.first_name, row.last_name].filter(Boolean).join(' ') || row.title || row.event_name || row.proposal_number || row.invoice_number || row.rendered_subject || row.recipient || row.reference_number || 'Record';
export function groupRecords(rows, field) {
  return Object.entries(rows.reduce((result, row) => {
    const name = row[field] ? labelize(row[field]) : 'Unassigned';
    result[name] = (result[name] || 0) + 1;
    return result;
  }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}
export function InsightPanel({ title, children, link, className = '', note }) {
  return <section className={`insight-panel ${className}`}><header><h2>{title}</h2>{link && <Link to={link}>View all →</Link>}</header>{note && <p className="insight-note">{note}</p>}{children}</section>;
}
export function EmptyInsight({ children = 'No activity recorded in this view.' }) {
  return <p className="insight-empty">{children}</p>;
}
export function Bars({ data = [], vertical = false, percent = false }) {
  const values = data.slice(0, 6), maximum = Math.max(1, ...values.map(item => Number(item.value) || 0)), total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  if (!values.length) return <EmptyInsight />;
  return <div className={vertical ? 'insight-bars-vertical' : 'insight-bars'}>{values.map((item, index) => <div key={item.name}><span>{item.name}</span><i style={vertical ? { height: `${Math.max(2, item.value / maximum * 85)}px`, background: chartColours[index % chartColours.length] } : { '--bar-size': `${item.value / maximum * 100}%`, '--bar-color': chartColours[index % chartColours.length] }} /><strong>{percent ? `${total ? Math.round(item.value / total * 100) : 0}%` : item.value}</strong></div>)}</div>;
}
export function Ring({ data = [], centre, label = 'Total', money = false }) {
  const values = data.filter(item => Number(item.value) > 0), total = data.reduce((sum, item) => sum + Number(item.value), 0);
  let angle = 0;
  const slices = values.map((item, index) => { const start = angle; angle += Number(item.value) / total * 100; return `${chartColours[index % chartColours.length]} ${start}% ${angle}%`; });
  return <div className="insight-ring-layout"><div className={`insight-ring ${total ? '' : 'is-empty'}`} style={total ? { background: `conic-gradient(${slices.join(',')})` } : undefined}><div><strong>{centre ?? (money ? formatMoney(total) : total)}</strong><span>{label}</span></div></div><div className="insight-ring-legend">{values.length ? values.slice(0, 6).map((item, index) => <div key={item.name}><i style={{ background: chartColours[index % chartColours.length] }} /><span>{item.name}</span><strong>{money ? formatMoney(item.value) : `${Math.round(item.value / total * 100)}%`}</strong></div>) : <EmptyInsight />}</div></div>;
}
export function ActivityList({ rows = [], dateField, getRowHref, money = false }) {
  return <div className="insight-activity">{rows.slice(0, 5).map(row => <div key={row.id}><span className="insight-activity-icon">{money ? <FileText size={16} /> : <CalendarDays size={16} />}</span><div>{getRowHref ? <Link to={getRowHref(row)}>{rowName(row)}</Link> : <strong>{rowName(row)}</strong>}<small>{row.client_name || row.event_name || row.email || row.recipient || labelize(row.status)}</small></div><time>{money ? formatMoney(row.amount || row.amount_outstanding || row.total) : formatDateOnly(row[dateField] || row.event_date || row.due_date || row.scheduled_at || row.updated_at || row.created_at)}</time></div>)}{!rows.length && <EmptyInsight />}</div>;
}
export function MiniCalendar({ rows = [] }) {
  const today = businessToday(), [year, month] = today.split('-').map(Number), first = new Date(year, month - 1, 1), offset = first.getDay(), days = new Date(year, month, 0).getDate();
  const eventDays = new Set(rows.filter(row => String(row.event_date || '').startsWith(today.slice(0, 7))).map(row => Number(String(row.event_date).slice(8, 10))));
  return <><div className="insight-calendar-month">{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div><div className="insight-calendar-grid">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => <strong key={day}>{day}</strong>)}{Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: days }, (_, index) => <span key={index} className={`${index + 1 === Number(today.slice(8)) ? 'today' : ''} ${eventDays.has(index + 1) ? 'has-event' : ''}`}>{index + 1}</span>)}</div></>;
}
export function Funnel({ values = [] }) {
  const maximum = Math.max(1, ...values.map(value => value.value));
  return <div className="insight-funnel">{values.map((item, index) => <div key={item.name}><div><strong>{item.value ?? '—'}</strong><span>{item.name}</span></div><i style={{ width: `${Math.max(18, Number(item.value || 0) / maximum * 100)}%`, background: chartColours[index % chartColours.length] }} /><small>{item.value == null ? '—' : `${Math.round(item.value / maximum * 100)}%`}</small></div>)}</div>;
}
export function StatusIcon({ status }) { return status === 'DONE' || status === 'SUCCEEDED' ? <CheckCircle2 size={16} /> : <Mail size={16} />; }
