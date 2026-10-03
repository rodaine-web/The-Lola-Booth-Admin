import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
const names = {
  GLAM: 'The LOLA Glam',
  '360': 'The LOLA 360',
  DUO: 'The Year-End Duo'
};
export default function CampaignInterest({
  unsubscribe = false
}) {
  const {
      token
    } = useParams(),
    [params] = useSearchParams();
  const [record, setRecord] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [form, setForm] = useState({
    package: ['GLAM', '360', 'DUO'].includes(params.get('package')) ? params.get('package') : '',
    event_date: '',
    event_time: '',
    location: '',
    website: ''
  });
  useEffect(() => {
    let active = true;
    setRecord(null);
    setError('');
    setDone(false);
    api.get('/public/campaigns/' + (unsubscribe ? 'unsubscribe/' : 'interest/') + token).then(r => {
      if (!active) return;
      setRecord(r);
      if (r.interest) {
        setForm({
          ...r.interest,
          website: ''
        });
        setDone(true);
      }
      if (unsubscribe && r.unsubscribed) setDone(true);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [token, unsubscribe]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.post('/public/campaigns/' + (unsubscribe ? 'unsubscribe/' : 'interest/') + token, unsubscribe ? {} : form);
      if (result.interest) setForm({
        ...result.interest,
        website: ''
      });
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const set = (key, value) => setForm(v => ({
    ...v,
    [key]: value
  }));
  return <main className="campaign-interest-shell"><div className="campaign-interest-card"><img src={record?.content?.images?.logo || "/campaigns/year-end-2026/logo.png"} alt="The LOLA Booth" />{error && <p className="campaign-error" role="alert">{error}</p>}{!record && !error ? <p>Opening your campaign…</p> : record && <>
 {unsubscribe ? <><h1>{done ? 'You’re unsubscribed.' : 'Marketing email preferences'}</h1><p>{done ? 'You will no longer receive marketing campaigns. Your event, proposal and invoice messages will continue.' : 'Stop receiving marketing campaigns from The LOLA Booth.'}</p>{!done && <form onSubmit={submit}><button disabled={busy} className="primary-action">{busy ? 'Updating…' : 'Unsubscribe'}</button></form>}</> : done ? <><h1>You’re all set.</h1><p>Thanks{record.first_name ? ', ' + record.first_name : ''}. We’ve received your event details and will confirm availability shortly.</p><dl><dt>Experience</dt><dd>{names[form.package]}</dd><dt>Date</dt><dd>{form.event_date}</dd><dt>Time</dt><dd>{form.event_time?.slice(0, 5)}</dd>{form.location && <><dt>Location</dt><dd>{form.location}</dd></>}</dl><a href="https://thelolabooth.com" className="primary-action">Visit The LOLA Booth</a><p>Need to make a change? Reply to your email or contact us.</p></> : record.unsubscribed ? <p>This marketing link has been unsubscribed.</p> : <><img className="hero" src={record?.content?.images?.hero || "/campaigns/year-end-2026/hero.jpg"} alt="Guests celebrating together" /><p>{record.first_name ? 'Hi ' + record.first_name + '. ' : ''}{record.company && 'A year-end experience for ' + record.company + '.'}</p><h1>Interested?</h1><p>We’ll confirm availability and send next steps. No commitment required.</p><form onSubmit={submit}><label className="campaign-field">Select package<select required value={form.package} onChange={e => set('package', e.target.value)}><option value="">Choose an experience</option>{Object.entries(names).map(([key, name]) => <option key={key} value={key}>{name} · ${Number(record.content[key === 'GLAM' ? 'glam_price' : key === '360' ? '360_price' : 'duo_price']).toLocaleString()} / 4 hours</option>)}</select></label><div className="campaign-grid"><label className="campaign-field">Event date<input type="date" required min={new Date().toISOString().slice(0, 10)} value={form.event_date} onChange={e => set('event_date', e.target.value)} /></label><label className="campaign-field">Event time<input type="time" required value={form.event_time} onChange={e => set('event_time', e.target.value)} /></label></div><label className="campaign-field">Location (optional)<input maxLength={300} placeholder="Venue, City or Neighborhood" value={form.location} onChange={e => set('location', e.target.value)} /></label><label className="campaign-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={e => set('website', e.target.value)} /></label><button className="primary-action" disabled={busy}>{busy ? 'Submitting…' : "I’M INTERESTED"}</button></form></>}
 <p style={{
          font: '20px Georgia',
          marginTop: 30
        }}>Good people. Better photos.</p></>}</div></main>;
}
