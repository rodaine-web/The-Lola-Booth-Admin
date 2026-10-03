import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { campaignContent } from '../../shared/campaign-content.js';
const steps = ['Details', 'Audience', 'Content', 'Interest CTA', 'Review', 'Send / Schedule'];
const tabs = ['Overview', 'Recipients', 'Interested', 'Content', 'Activity', 'Settings'];
const blank = {
  name: '',
  description: '',
  type: 'CORPORATE_OUTREACH',
  subject: "{{contact.first_name}}, make {{company.name}}'s year-end celebration unforgettable",
  preview_text: 'The LOLA Glam, The LOLA 360 or both. Premium year-end experiences for your team.',
  sender_name: 'The LOLA Booth',
  reply_to: 'info@thelolabooth.com',
  timezone: 'America/Chicago',
  content_json: campaignContent(),
  audience_json: {
    ids: [],
    companies: [],
    source: '',
    tags: [],
    manual: []
  }
};
function Field({
  label,
  value,
  onChange,
  type = 'text',
  ...props
}) {
  return <label className="campaign-field">{label}{type === 'textarea' ? <textarea rows={4} value={value ?? ''} onChange={e => onChange(e.target.value)} {...props} /> : <input type={type} value={value ?? ''} onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)} {...props} />}</label>;
}
function Table({
  heads,
  children
}) {
  return <div className="campaign-table-wrap"><table className="campaign-list"><thead><tr>{heads.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
export default function Campaigns() {
  const {
      id
    } = useParams(),
    navigate = useNavigate(),
    {
      user,
      can
    } = useAuth();
  const [list, setList] = useState([]),
    [campaign, setCampaign] = useState(null),
    [contacts, setContacts] = useState([]),
    [draft, setDraft] = useState(blank),
    [editing, setEditing] = useState(false),
    [step, setStep] = useState(0),
    [tab, setTab] = useState('Overview'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState({
      search: '',
      status: '',
      type: ''
    }),
    [audience, setAudience] = useState(null),
    [preview, setPreview] = useState(null),
    [mobile, setMobile] = useState(false),
    [sampleId, setSampleId] = useState(''),
    [schedule, setSchedule] = useState(''),
    [testEmail, setTestEmail] = useState(user?.email || ''),
    [confirm, setConfirm] = useState(null),
    [contactSearch, setContactSearch] = useState(''),
    [manual, setManual] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    if (!can('campaigns.read')) return;
    Promise.all([id ? api.get('/campaigns/' + id) : api.get('/campaigns?' + new URLSearchParams(filter)), api.get('/campaigns/contacts')]).then(([data, c]) => {
      if (!live) return;
      setContacts(c);
      if (id) {
        setCampaign(data);
        setDraft({
          ...data,
          content_json: campaignContent(data.content_json)
        });
      } else setList(data.data);
    }).catch(e => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, filter, can]);
  useEffect(() => {
    if (!editing) return;
    let live = true;
    const timer = setTimeout(() => api.post('/campaigns/audience-preview', draft.audience_json).then(r => live && setAudience(r)).catch(e => live && setError(e.message)), 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft.audience_json, editing]);
  const change = (key, value) => setDraft(d => ({
      ...d,
      [key]: value
    })),
    content = (key, value) => change('content_json', {
      ...draft.content_json,
      [key]: value
    });
  const selected = contacts.find(c => c.id === sampleId) || {
    first_name: 'Jordan',
    company: 'Northstar Group'
  };
  async function refresh() {
    if (id) {
      const c = await api.get('/campaigns/' + id);
      setCampaign(c);
      setDraft(c);
    } else setList((await api.get('/campaigns')).data);
  }
  async function run(fn) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const saved = await (id ? api.patch('/campaigns/' + id, draft) : api.post('/campaigns', draft));
    setDraft(saved);
    if (!id) navigate('/communications/campaigns/' + saved.id);
    setCampaign(await api.get('/campaigns/' + saved.id));
    return saved;
  }
  async function showPreview() {
    const c = editing ? await save() : campaign;
    const p = await api.post('/campaigns/' + c.id + '/preview', {
      sample: selected
    });
    setPreview(p);
  }
  async function action(action) {
    await api.post('/campaigns/' + id + '/' + action, {});
    await refresh();
    setConfirm(null);
  }
  const permitted = permission => can('campaigns.' + permission);
  const editable = campaign && ['DRAFT', 'READY'].includes(campaign.status);
  if (!permitted('read')) return <main className="page"><h1>Campaigns</h1><p>You do not have access to campaigns.</p></main>;
  return <main className="page"><div className="page-header"><div><p className="eyebrow">COMMUNICATIONS</p><h1>{editing ? id ? 'Edit campaign' : 'Create campaign' : campaign?.name || 'Campaigns'}</h1><p>Thoughtful outreach. Real connections.</p></div><div className="campaign-toolbar">{id && <Link to="/communications/campaigns" onClick={() => {
          setEditing(false);
          setPreview(null);
        }}>All campaigns</Link>}{!id && !editing && permitted('create') && <button className="primary-action" onClick={() => {
          setDraft({
            ...blank,
            content_json: campaignContent()
          });
          setEditing(true);
          setStep(0);
        }}>+ Create Campaign</button>}{editable && !editing && permitted('edit') && <button onClick={() => {
          setEditing(true);
          setStep(0);
        }}>Edit campaign</button>}{campaign && !editing && permitted('create') && <button onClick={() => run(async () => {
          const c = await api.post('/campaigns/' + id + '/duplicate', {});
          navigate('/communications/campaigns/' + c.id);
          setNotice('Duplicated as a draft with no recipients or delivery history.');
        })}>Duplicate</button>}</div></div>
 {error && <p role="alert" className="campaign-error">{error}</p>}{notice && <p role="status">{notice}</p>}
 {editing ? <><nav className="campaign-tabs" aria-label="Campaign steps">{steps.map((name, i) => <button key={name} className={step === i ? 'active' : ''} onClick={() => setStep(i)}>{i + 1}. {name}</button>)}</nav><div className="campaign-panel">
 {step === 0 && <><Field label="Campaign name" required value={draft.name} onChange={v => change('name', v)} /><label className="campaign-field">Template<select value="corporate-year-end-2026" readOnly><option>2026 Corporate Year-End Celebration</option></select></label><Field label="Internal description" value={draft.description} onChange={v => change('description', v)} type="textarea" /><label className="campaign-field">Campaign type<select value={draft.type} onChange={e => change('type', e.target.value)}>{['CORPORATE_OUTREACH', 'EMPLOYEE_APPRECIATION', 'SUMMER_EVENT', 'OTHER'].map(t => <option key={t}>{t}</option>)}</select></label><div className="campaign-grid"><Field label="Sender name" value={draft.sender_name} onChange={v => change('sender_name', v)} /><Field label="Reply-to email" type="email" value={draft.reply_to} onChange={v => change('reply_to', v)} /></div><Field label="Subject" value={draft.subject} onChange={v => change('subject', v)} /><p>Use {'{{contact.first_name}}'} and {'{{company.name}}'}. Missing names use a safe subject fallback.</p><Field label="Preview text" value={draft.preview_text} onChange={v => change('preview_text', v)} /></>}
 {step === 1 && <><h2>Choose your audience</h2><p>Only contacts with marketing consent are eligible. Duplicate emails, unsubscribed and suppressed addresses are excluded.</p><div className="campaign-metrics"><div>Eligible recipients<strong>{audience?.count ?? '…'}</strong></div><div>Excluded<strong>{audience?.excluded?.length ?? '…'}</strong></div></div><div className="campaign-grid"><Field label="Search contacts, companies or emails" value={contactSearch} onChange={setContactSearch} /><label className="campaign-field">Company<select value="" onChange={e => {
                if (e.target.value) change('audience_json', {
                  ...draft.audience_json,
                  companies: [...new Set([...draft.audience_json.companies, e.target.value])]
                });
              }}><option value="">Add a company</option>{[...new Set(contacts.map(c => c.company).filter(Boolean))].sort().map(c => <option key={c}>{c}</option>)}</select></label></div>{draft.audience_json.companies.map(c => <button key={c} onClick={() => change('audience_json', {
            ...draft.audience_json,
            companies: draft.audience_json.companies.filter(x => x !== c)
          })}>{c} ×</button>)}<label className="campaign-field">Tag audience<select value="" onChange={e => {
              if (e.target.value) change('audience_json', {
                ...draft.audience_json,
                tags: [...new Set([...(draft.audience_json.tags || []), e.target.value])]
              });
            }}><option value="">Add a tag</option>{[...new Set(contacts.flatMap(c => c.tags || []))].map(t => <option key={t}>{t}</option>)}</select></label>{(draft.audience_json.tags || []).map(t => <button key={t} onClick={() => change('audience_json', {
            ...draft.audience_json,
            tags: draft.audience_json.tags.filter(x => x !== t)
          })}>{t} ×</button>)}<Field label="Source filter (optional)" value={draft.audience_json.source} onChange={v => change('audience_json', {
            ...draft.audience_json,
            source: v
          })} /><div style={{
            maxHeight: 350,
            overflow: 'auto'
          }}>{contacts.filter(c => [c.first_name, c.last_name, c.email, c.company].join(' ').toLowerCase().includes(contactSearch.toLowerCase())).map(c => <label className="campaign-selection" key={c.id}><input type="checkbox" checked={draft.audience_json.ids.includes(c.id)} onChange={e => change('audience_json', {
                ...draft.audience_json,
                ids: e.target.checked ? [...draft.audience_json.ids, c.id] : draft.audience_json.ids.filter(x => x !== c.id)
              })} /><span><strong>{c.first_name} {c.last_name}</strong><br />{c.email} · {c.company || 'No company'} · {c.marketing_email_opt_in ? 'Consented' : 'No marketing consent'}</span></label>)}</div><Field label="Manual recipient email" type="email" value={manual} onChange={setManual} /><button onClick={() => {
            if (manual) {
              change('audience_json', {
                ...draft.audience_json,
                manual: [...draft.audience_json.manual, {
                  email: manual,
                  first_name: '',
                  last_name: '',
                  company: '',
                  marketing_email_opt_in: false
                }]
              });
              setManual('');
            }
          }}>Add recipient</button>{draft.audience_json.manual.map((r, i) => <div className="campaign-selection" key={i}><span>{r.email}</span><label><input type="checkbox" checked={r.marketing_email_opt_in} onChange={e => change('audience_json', {
                ...draft.audience_json,
                manual: draft.audience_json.manual.map((x, j) => j === i ? {
                  ...x,
                  marketing_email_opt_in: e.target.checked
                } : x)
              })} /> I have this recipient’s marketing consent</label><button onClick={() => change('audience_json', {
              ...draft.audience_json,
              manual: draft.audience_json.manual.filter((_, j) => j !== i)
            })}>Remove</button></div>)}{audience?.excluded?.length > 0 && <details><summary>Review exclusions</summary>{audience.excluded.map((c, i) => <p key={i}>{c.email || c.first_name}: {c.reason}</p>)}</details>}</>}
 {step === 2 && <><Field label="Hero headline" value={draft.content_json.headline} onChange={v => content('headline', v)} /><Field label="Intro" type="textarea" value={draft.content_json.intro} onChange={v => content('intro', v)} /><div className="campaign-grid">{['glam', '360', 'duo'].map(key => <div key={key}><h3>{key === 'duo' ? 'Year-End Duo' : key === 'glam' ? 'LOLA Glam' : 'LOLA 360'}</h3><Field label="4-hour price ($)" type="number" min="0" value={draft.content_json[key + '_price']} onChange={v => content(key + '_price', v)} /><Field label="Additional hour ($)" type="number" min="0" value={draft.content_json[key + '_extra']} onChange={v => content(key + '_extra', v)} />{<Field label="Features (one per line)" type="textarea" value={draft.content_json[key + '_features'].join('\n')} onChange={v => content(key + '_features', v.split('\n').filter(Boolean))} />}</div>)}</div><h3>Campaign images</h3><p>Choose a published media URL from the Media Library, or use the approved hosted assets.</p><Link to="/website/media-library">Open Media Library</Link>{Object.entries(draft.content_json.images).map(([key, value]) => <Field key={key} label={key + ' image URL'} value={value} onChange={v => content('images', {
            ...draft.content_json.images,
            [key]: v
          })} />)}<Field label="Footer contact details" value={draft.content_json.footer} onChange={v => content('footer', v)} /><Field label="Business mailing address" value={draft.content_json.mailing_address} onChange={v => content('mailing_address', v)} /></>}
 {step === 3 && <><h2>A simple declaration of interest</h2><p>Recipients provide package, event date, event time and an optional location. Package links preselect the experience and remain changeable.</p><Field label="Primary button text" value={draft.content_json.cta} onChange={v => content('cta', v)} /><p>We’ll confirm availability and send next steps. No commitment required.</p><p>Responses create CRM interest and notifications. Your team decides when to create a proposal or event.</p></>}
 {step === 4 && <><h2>Review your campaign</h2><p><strong>{draft.name}</strong> · {audience?.count ?? '…'} eligible recipients</p><p>Reply to: {draft.reply_to}</p><label className="campaign-field">Sample recipient<select value={sampleId} onChange={e => setSampleId(e.target.value)}><option value="">Jordan · Northstar Group</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.first_name} · {c.company || 'No company'}</option>)}</select></label>{sampleId && (!selected.first_name || !selected.company) && <p role="status">Missing personalization: {!selected.first_name ? 'first name ' : ''}{!selected.company ? 'company' : ''}. Safe fallbacks will be used.</p>}<div className="campaign-toolbar"><button onClick={() => run(showPreview)}>Preview with sample recipient</button><button onClick={() => setMobile(v => !v)}>{mobile ? 'Desktop preview' : 'Mobile preview (375px)'}</button></div></>}
 {step === 5 && <><h2>Send when you’re ready</h2><p>{audience?.count ?? '…'} eligible recipients · Sender: {draft.sender_name}</p><Field label="Test email address" type="email" value={testEmail} onChange={setTestEmail} />{permitted('send') && <button disabled={busy} onClick={() => run(async () => {
            const c = await save();
            await api.post('/campaigns/' + c.id + '/test', {
              email: testEmail,
              sample: selected
            });
            setNotice('Test accepted by the email provider.');
          })}>Send test campaign</button>}<div className="campaign-grid"><Field label="Schedule date and time" type="datetime-local" value={schedule} onChange={setSchedule} /><Field label="Timezone" value={draft.timezone} onChange={v => change('timezone', v)} /></div><p>Schedule uses the selected timezone: {draft.timezone}.</p><div className="campaign-toolbar">{permitted('send') && <button className="primary-action" onClick={() => run(async () => {
              await save();
              setAudience(await api.post('/campaigns/audience-preview', draft.audience_json));
              setConfirm('send');
            })}>Send Now</button>}{permitted('schedule') && <button disabled={!schedule} onClick={() => run(async () => {
              await save();
              setAudience(await api.post('/campaigns/audience-preview', draft.audience_json));
              setConfirm('schedule');
            })}>Schedule</button>}</div></>}
 <div className="campaign-step-footer"><button onClick={() => step > 0 ? setStep(step - 1) : setEditing(false)}>{step ? 'Back' : 'Cancel'}</button><div className="campaign-toolbar"><button disabled={busy} onClick={() => run(async () => {
              await save();
              setNotice('Draft saved.');
            })}>Save draft</button>{step < 5 && <button className="primary-action" onClick={() => setStep(step + 1)}>Continue →</button>}</div></div></div></> : !id ? <><div className="campaign-toolbar"><Field label="Search campaigns, companies or emails" value={filter.search} onChange={v => setFilter({
          ...filter,
          search: v
        })} /><Field label="Audience / company / tag" value={filter.audience||''} onChange={v=>setFilter({...filter,audience:v})}/><Field label="Created from" type="date" value={filter.from||''} onChange={v=>setFilter({...filter,from:v})}/><Field label="Created through" type="date" value={filter.to||''} onChange={v=>setFilter({...filter,to:v})}/><label className="campaign-field">Creator<select value={filter.owner||''} onChange={e=>setFilter({...filter,owner:e.target.value})}><option value="">All creators</option>{[...new Map(list.filter(c=>c.created_by).map(c=>[c.created_by,c])).values()].map(c=><option key={c.created_by} value={c.created_by}>{c.creator_name||c.created_by}</option>)}</select></label><label className="campaign-field">Status<select value={filter.status} onChange={e => setFilter({
            ...filter,
            status: e.target.value
          })}><option value="">All statuses</option>{['DRAFT', 'READY', 'SCHEDULED', 'SENDING', 'SENT', 'PAUSED', 'CANCELLED', 'FAILED', 'ARCHIVED'].map(s => <option key={s}>{s}</option>)}</select></label><label className="campaign-field">Type<select value={filter.type} onChange={e => setFilter({
            ...filter,
            type: e.target.value
          })}><option value="">All campaign types</option>{['CORPORATE_OUTREACH', 'EMPLOYEE_APPRECIATION', 'SUMMER_EVENT', 'OTHER'].map(s => <option key={s}>{s}</option>)}</select></label></div><div className="campaign-panel"><Table heads={['Campaign', 'Type', 'Status', 'Recipients', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Interested', 'Creator', 'Updated']}>{list.map(c => <tr key={c.id}><td><Link to={'/communications/campaigns/' + c.id}>{c.name}</Link></td><td>{c.type.replaceAll('_', ' ')}</td><td><span className="status-chip">{c.status}</span></td><td>{c.recipients}</td><td>{c.sent}</td><td>Unavailable</td><td>Unavailable</td><td>Unavailable</td><td>{c.interested}</td><td>{c.creator_name||'Unassigned'}</td><td>{new Date(c.updated_at).toLocaleDateString()}</td></tr>)}</Table>{!list.length && !error && <p>Your campaigns will appear here. Start with the approved year-end template.</p>}</div></> : campaign && <><nav className="campaign-tabs" aria-label="Campaign details">{tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav><div className="campaign-panel">
 {tab === 'Overview' && <><p><span className="status-chip">{campaign.status}</span> · {campaign.type.replaceAll('_', ' ')}</p><div className="campaign-metrics">{Object.entries(campaign.metrics).map(([key, value]) => <div key={key}>{key.replaceAll('_', ' ')}<strong>{value ?? 'Unavailable'}</strong></div>)}</div><p>{campaign.provider_note}</p><p>{campaign.scheduled_at ? 'Scheduled: ' + new Date(campaign.scheduled_at).toLocaleString('en-US', {
              timeZone: campaign.timezone
            }) + ' · ' + campaign.timezone : 'Not scheduled'}</p><div className="campaign-toolbar">{editable && permitted('send') && <button className="primary-action" onClick={() => {
              setEditing(true);
              setStep(5);
            }}>Send / Schedule</button>}{['SENDING', 'SCHEDULED'].includes(campaign.status) && permitted('cancel') && <button onClick={() => run(() => action('pause'))}>Pause</button>}{campaign.status === 'FAILED' && permitted('send') && <button onClick={() => run(() => action('retry'))}>Retry safe failures</button>}{campaign.status === 'PAUSED' && permitted('send') && <button onClick={() => run(() => action('resume'))}>Resume</button>}{['DRAFT', 'READY', 'SENDING', 'SCHEDULED', 'PAUSED'].includes(campaign.status) && permitted('cancel') && <button onClick={() => setConfirm('cancel')}>Cancel unsent recipients</button>}{['DRAFT', 'READY', 'SENT', 'FAILED', 'CANCELLED'].includes(campaign.status) && permitted('edit') && <button onClick={() => run(() => action('archive'))}>Archive</button>}</div></>}
 {tab === 'Recipients' && <Table heads={['Recipient', 'Company', 'Email', 'Status', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Interested', 'Last Activity', 'Failure']}>{campaign.recipients.map(r => <tr key={r.id}><td>{r.first_name} {r.last_name}</td><td>{r.company}</td><td>{r.email}</td><td>{r.status}</td><td>{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</td><td>Unavailable</td><td>Unavailable</td><td>Unavailable</td><td>{r.interested_at ? 'Yes' : '—'}</td><td>{new Date(r.interested_at||r.failed_at||r.sent_at||r.queued_at||r.created_at).toLocaleString()}</td><td>{r.failure_message || '—'}</td></tr>)}</Table>}
 {tab === 'Interested' && <><Table heads={['Name', 'Company', 'Package', 'Date', 'Time', 'Location', 'Submitted', 'Lead status', 'Owner', 'Next step']}>{campaign.interests.map(r => <tr key={r.id}><td>{r.first_name} {r.last_name}</td><td>{r.company}</td><td>{r.package}</td><td>{r.event_date}</td><td>{r.event_time}</td><td>{r.location || '—'}</td><td>{new Date(r.submitted_at).toLocaleString()}</td><td>{r.lead_status || 'Prospect'}</td><td>{r.owner || 'Unassigned'}</td><td>{r.lead_id ? <Link to={'/sales/leads/' + r.lead_id}>Open lead</Link> : r.client_id ? <Link to={'/sales/clients/' + r.client_id}>Open contact</Link> : can('write:sales') && <button onClick={() => run(async () => {
                  const converted = await api.post('/campaigns/' + id + '/interests/' + r.id + '/convert', {});
                  navigate('/sales/leads/' + converted.lead_id);
                })}>Convert to Lead</button>}<br /><Link to={'/sales/proposals/new' + (r.lead_id ? '?leadId=' + r.lead_id : '')}>Create proposal</Link></td></tr>)}</Table>{!campaign.interests.length && <p>Interest responses will appear here with the requested package, date, time and location.</p>}</>}
 {tab === 'Content' && <><p>Subject: {campaign.subject}</p><label className="campaign-field">Sample recipient<select value={sampleId} onChange={e => setSampleId(e.target.value)}><option value="">Jordan · Northstar Group</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.first_name} · {c.company}</option>)}</select></label><div className="campaign-toolbar"><button onClick={() => run(showPreview)}>Preview email</button><button onClick={() => setMobile(v => !v)}>{mobile ? 'Desktop' : 'Mobile 375px'}</button></div><Field label="Test email address" value={testEmail} onChange={setTestEmail} type="email" />{permitted('send') && <button disabled={busy} onClick={() => run(async () => {
            await api.post('/campaigns/' + id + '/test', {
              email: testEmail,
              sample: selected
            });
            setNotice('Test accepted by the email provider.');
          })}>Send test</button>}</>}
 {tab === 'Activity' && campaign.activity.map(e => <div className="campaign-selection" key={e.id}><time>{new Date(e.created_at).toLocaleString()}</time><strong>{e.event_type.replaceAll('_', ' ')}</strong><span>{e.metadata?.actor || e.metadata?.message || ''}</span></div>)}
 {tab === 'Settings' && <><p>Sender: {campaign.sender_name}</p><p>Reply to: {campaign.reply_to}</p><p>Timezone: {campaign.timezone}</p><p>Channel: Email</p><p>Template: 2026 Corporate Year-End Celebration</p><p>Mailing address: {campaign.content_json.mailing_address || 'Required before sending'}</p></>}
 </div></>}
 {preview && <><p>Preview subject: {preview.subject}</p><iframe sandbox="" title="Personalized campaign preview" srcDoc={preview.html} className="campaign-preview" style={{
        width: mobile ? 375 : 680
      }} /></>}
 {confirm && <div className="campaign-confirmation"><div role="dialog" aria-modal="true" aria-labelledby="campaign-confirm" className="campaign-panel"><h2 id="campaign-confirm">{confirm === 'cancel' ? 'Cancel unsent recipients?' : 'You are about to ' + (confirm === 'schedule' ? 'schedule' : 'send') + ' this campaign'}</h2><p>{draft.name} · {audience?.count ?? campaign?.metrics?.recipients} recipients</p><p>Sender: {draft.sender_name}<br />Subject: {draft.subject}</p><p>Already claimed messages may finish. Paused or cancelled campaigns will not claim additional recipients.</p><div className="campaign-toolbar"><button onClick={() => setConfirm(null)}>Go back</button><button disabled={busy} className="primary-action" onClick={() => run(async () => {
          if (confirm === 'cancel') await action('cancel');else {
            await api.post('/campaigns/' + id + '/' + confirm, confirm === 'schedule' ? {
              scheduled_at: zonedSchedule(schedule, draft.timezone)
            } : {});
            setConfirm(null);
            setEditing(false);
            await refresh();
            setNotice('Campaign queued. The worker will process eligible recipients.');
          }
        })}>{confirm === 'cancel' ? 'Cancel campaign' : confirm === 'schedule' ? 'Schedule campaign' : 'Send campaign'}</button></div></div></div>}
 </main>;
}
function zonedSchedule(value, timeZone) {
  const target = new Date(value + 'Z');
  let date = new Date(target);
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date).map(p => [p.type, p.value]));
    const wall = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
    date = new Date(date.getTime() + target.getTime() - wall.getTime());
  }
  return date.toISOString();
}
