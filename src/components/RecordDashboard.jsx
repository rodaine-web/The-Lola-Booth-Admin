import { experienceImage } from "../utils/experience-assets.js";
import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Users, Check, ArrowRight, FileText } from 'lucide-react';
import { api } from '../api/client.js';
import { formatDateOnly, formatTimestamp } from '../utils/display.js';
import { bookingOverview } from '../utils/booking-overview.js';

export function useRecordJourney(event, proposals = [], lead) {
  const proposal = proposals.find(p => ['ACCEPTED', 'CONVERTED'].includes(p.status)) || proposals[0];
  const [agreement, setAgreement] = useState({ proposalId: null, records: null });
  useEffect(() => {
    let current = true;
    if (proposal?.id) api.get(`/proposals/${proposal.id}/contracts`).then(records => {
      if (current) setAgreement({ proposalId: proposal.id, records });
    }).catch(() => { if (current) setAgreement({ proposalId: proposal.id, records: null }); });
    return () => { current = false; };
  }, [proposal?.id, proposal?.updated_at]);
  return bookingOverview({ event, proposal, lead, contracts: agreement.proposalId === proposal?.id ? agreement.records : null });
}

export function RecordIdentity({ name, status, subtitle, event, actions, image }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('');
  return <header className="record-identity">
    {image ? <img className="record-portrait" src={image} alt="" /> : <div className="record-avatar" aria-hidden="true">{initials}</div>}
    <div className="record-identity-copy"><div className="record-title"><h1>{name}</h1>{status && <span className={`record-status ${/inquiry|new|tentative/i.test(status) ? "inquiry" : /lost|archived|cancelled/i.test(status) ? "closed" : ""}`}>{status.replaceAll('_', ' ')}</span>}</div><p className="record-contact">{subtitle}</p>
      {event && <div className="record-meta"><span><CalendarDays size={18}/>{event.event_date ? formatDateOnly(event.event_date) : 'Date TBD'}</span><span><MapPin size={18}/>{[event.city, event.state].filter(Boolean).join(', ') || event.venue_name || 'Location TBD'}</span><span>{event.event_type || 'Event type TBD'}</span><span><Users size={18}/>{event.guest_count ?? 'TBD'} guests</span></div>}
    </div><div className="record-header-actions">{actions}</div>
  </header>;
}
export function JourneyStrip({ journey, lead = false }) {
  const steps = lead ? [journey.steps[0], {key:'sent',label:'Proposal Sent',complete:journey.sent,detail:journey.sent?'Sent':'Pending'}, {...journey.steps[1],label:'Proposal Accepted'}, journey.steps[2], journey.steps[3], journey.confirmation] : journey.steps;
  return <ol className="record-journey" aria-label="Booking progress">{steps.map((step, i) => <li key={step.key} className={step.complete ? 'complete' : i === steps.findIndex(s => !s.complete) ? 'current' : ''}><span className="journey-dot">{step.complete ? <Check size={19}/> : i + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div>{i < steps.length - 1 && <ArrowRight size={16} className="journey-arrow"/>}</li>)}</ol>;
}
export function DashboardCard({ title, action, children, className = '' }) {
  return <section className={`record-dashboard-card ${className}`}><div className="record-card-heading"><h2>{title}</h2>{action}</div>{children}</section>;
}
export function NextBookingAction({ journey, proposalHref, onPlanning, onFinance, onTasks }) {
  const href = journey.proposal ? `/sales/proposals/${journey.proposal.id}` : proposalHref;
  return <DashboardCard title="Next Action" className="record-next-action" action={onTasks && <button className="record-text-action" onClick={onTasks}>View all tasks →</button>}><div className="record-next-icon"><FileText size={25}/></div><h3>{journey.next.title}</h3><p>{journey.next.description}</p>{journey.next.kind === 'planning' && onPlanning ? <button className="primary-action" onClick={onPlanning}>Open Planning <ArrowRight size={16}/></button> : journey.next.kind === 'balance' && onFinance ? <button className="primary-action" onClick={onFinance}>View Payments <ArrowRight size={16}/></button> : <Link className="primary-action" to={href}>{journey.next.action} <ArrowRight size={16}/></Link>}</DashboardCard>;
}
export function RecordActivity({ rows = [], onView }) {
  return <DashboardCard title="Recent Activity" action={onView && <button className="record-text-action" onClick={onView}>View all →</button>}><div className="record-activity-list">{rows.slice(0, 4).map((row, index) => <article key={row.id || index}><strong>{row.summary || row.action?.replaceAll('_', ' ')}</strong><small>{row.created_at ? formatTimestamp(row.created_at) : 'Date not recorded'}</small></article>)}{!rows.length && <p className="record-muted">No activity recorded yet.</p>}</div></DashboardCard>;
}
export function RequestedItems({ experiences = [], addons = [], packages = [] }) {
  return <div className="record-requested"><div><h3>Experiences & Packages</h3>{experiences.map((item, i) => <p className="record-experience-item" key={item.id || item.experienceId || i}><img src={item.image_url || experienceImage(item.name || item.experienceName)} alt="" loading="lazy"/><span><strong>{item.name || item.experienceName}</strong>{item.packageName && <small>{item.packageName}</small>}</span></p>)}{packages.map((item, i) => <p key={item.id || i}>{item.name}</p>)}{!experiences.length && !packages.length && <p className="record-muted">Not selected</p>}</div><div><h3>Add-ons</h3>{addons.map((item, i) => <p key={item.id || item.addonId || i}>{item.name} × {item.quantity ?? 1}</p>)}{!addons.length && <p className="record-muted">None selected</p>}</div></div>;
}

export function RecordEditDialog({ title, fields, record, onSave, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => { const dialog = dialogRef.current; dialog.showModal(); return () => dialog.close(); }, []);
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(field => [field.key, record[field.key] ?? ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="modal-backdrop"><dialog ref={dialogRef} onCancel={e=>{e.preventDefault();if(!busy)onClose();}} aria-modal="true" aria-labelledby="record-edit-title" className="modal record-edit-dialog"><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await onSave(Object.fromEntries(fields.map(field=>[field.key,values[field.key] === "" && !field.required ? null : values[field.key]]))); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); } }}><div className="modal-heading"><h2 id="record-edit-title">{title}</h2><button type="button" disabled={busy} onClick={onClose}>Close</button></div><p>Fields marked * are required.</p>{error && <p role="alert" className="toast error">{error}</p>}<div className="form-grid">{fields.map(field => <label key={field.key}>{field.label}{field.required ? ' *' : ''}<input autoFocus={fields[0].key === field.key} required={field.required} min={field.min} type={field.type || 'text'} value={values[field.key]} onChange={e=>setValues(current=>({...current,[field.key]:e.target.value}))}/></label>)}</div><div className="modal-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-action" disabled={busy}>Save Changes</button></div></form></dialog></div>;
}
