import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import CampaignBuilder from '../components/campaigns/CampaignBuilder.jsx';
import { campaignContent } from '../../shared/campaign-content.js';
const tabs = ['Overview', 'Recipients', 'Interested', 'Content', 'Activity', 'Settings'];
const blank = {
  name: '',
  description: '',
  type: 'CORPORATE_OUTREACH',
  subject: 'A special offer from The LOLA Booth',
  preview_text: 'The LOLA Glam, The LOLA 360 or both. Premium year-end experiences for your team.',
  sender_name: 'The LOLA Booth',
  sender_email: '',
  reply_to: 'info@thelolabooth.com',
  timezone: 'America/Chicago',
  content_json: campaignContent({format:'TEXT',headline:'A special offer for your event',text_body:''}),
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
    [selectedCampaign,setSelectedCampaign] = useState(null);
  const confirmationRef=useRef(null);
  useEffect(()=>{setCampaign(null);setSelectedCampaign(null);setConfirm(null);},[id]);
  useEffect(()=>{if(!confirm)return;const before=document.activeElement;confirmationRef.current?.querySelector('button')?.focus();return()=>before?.focus();},[confirm]);
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
  const lifecycleTarget = selectedCampaign || campaign;
  const askLifecycle = (kind, target) => {setSelectedCampaign(target);setConfirm(kind);};
  const permitted = permission => can('campaigns.' + permission);
  const editable = campaign && ['DRAFT', 'READY'].includes(campaign.status);
  if (!permitted('read')) return <main className="page"><h1>Campaigns</h1><p>You do not have access to campaigns.</p></main>;
  return <main className="page"><div className="page-header"><div><p className="eyebrow">COMMUNICATIONS</p><h1>{editing ? id ? 'Edit campaign' : 'Create campaign' : campaign?.name || 'Campaigns'}</h1><p>Thoughtful outreach. Real connections.</p></div><div className="campaign-toolbar">{id && <Link to="/communications/campaigns" onClick={() => {
          setEditing(false);
          setPreview(null);
        }}>All campaigns</Link>}{!id && !editing && permitted('create') && <button className="primary-action" onClick={() => {
          setDraft({
            ...blank,
            content_json: campaignContent({format:'TEXT',headline:'A special offer for your event',text_body:''})
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
 {editing ? <CampaignBuilder draft={draft} setDraft={setDraft} contacts={contacts} audience={audience} busy={busy} initialStep={step} onSave={save} onClose={()=>setEditing(false)} run={run} canSend={permitted('send')} canSchedule={permitted('schedule')} schedule={schedule} setSchedule={setSchedule} testEmail={testEmail} setTestEmail={setTestEmail} onDelivery={mode=>run(async()=>{await save();setAudience(await api.post('/campaigns/audience-preview',draft.audience_json));setConfirm(mode);})} onTest={sample=>run(async()=>{const saved=await save();await api.post('/campaigns/'+saved.id+'/test',{email:testEmail,sample});setNotice('Test accepted by the email provider.');})}/> : !id ? <><div className="campaign-toolbar"><Field label="Search campaigns, companies or emails" value={filter.search} onChange={v => setFilter({
          ...filter,
          search: v
        })} /><Field label="Audience / company / tag" value={filter.audience||''} onChange={v=>setFilter({...filter,audience:v})}/><Field label="Created from" type="date" value={filter.from||''} onChange={v=>setFilter({...filter,from:v})}/><Field label="Created through" type="date" value={filter.to||''} onChange={v=>setFilter({...filter,to:v})}/><label className="campaign-field">Creator<select value={filter.owner||''} onChange={e=>setFilter({...filter,owner:e.target.value})}><option value="">All creators</option>{[...new Map(list.filter(c=>c.created_by).map(c=>[c.created_by,c])).values()].map(c=><option key={c.created_by} value={c.created_by}>{c.creator_name||c.created_by}</option>)}</select></label><label className="campaign-field">Status<select value={filter.status} onChange={e => setFilter({
            ...filter,
            status: e.target.value
          })}><option value="">Active campaigns</option>{['DRAFT', 'READY', 'SCHEDULED', 'SENDING', 'SENT', 'PAUSED', 'CANCELLED', 'FAILED', 'ARCHIVED'].map(s => <option key={s}>{s}</option>)}</select></label><label className="campaign-field">Type<select value={filter.type} onChange={e => setFilter({
            ...filter,
            type: e.target.value
          })}><option value="">All campaign types</option>{['CORPORATE_OUTREACH', 'EMPLOYEE_APPRECIATION', 'SUMMER_EVENT', 'OTHER'].map(s => <option key={s}>{s}</option>)}</select></label></div><div className="campaign-panel"><Table heads={['Campaign', 'Type', 'Status', 'Recipients', 'Sent', 'Delivered', 'Opened (estimated)', 'Clicked', 'Interested', 'Creator', 'Updated', 'Actions']}>{list.map(c => <tr key={c.id}><td><Link to={'/communications/campaigns/' + c.id}>{c.name}</Link></td><td>{c.type.replaceAll('_', ' ')}</td><td><span className="status-chip">{c.status}</span></td><td>{c.recipients}</td><td>{c.sent}</td><td>Unavailable</td><td>{c.opened ?? 'Unavailable'}</td><td>{c.clicked ?? 'Unavailable'}</td><td>{c.interested}</td><td>{c.creator_name||'Unassigned'}</td><td>{new Date(c.updated_at).toLocaleDateString()}</td><td>{permitted('edit') && <div className="campaign-toolbar">{['DRAFT','READY','SENT','FAILED','CANCELLED'].includes(c.status) && <button onClick={()=>askLifecycle('archive',c)}>Archive</button>}{c.can_delete && <button onClick={()=>askLifecycle('delete',c)}>Delete draft</button>}</div>}</td></tr>)}</Table>{!list.length && !error && <p>Your campaigns will appear here. Start with the approved year-end template.</p>}</div></> : campaign && <><nav className="campaign-tabs" aria-label="Campaign details">{tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav><div className="campaign-panel">
 {tab === 'Overview' && <><p><span className="status-chip">{campaign.status}</span> · {campaign.type.replaceAll('_', ' ')}</p><div className="campaign-metrics">{Object.entries(campaign.metrics).map(([key, value]) => <div key={key}>{key==='opened'?'opened (estimated)':key.replaceAll('_', ' ')}<strong>{value ?? 'Unavailable'}</strong></div>)}</div><p>{campaign.provider_note}</p><p>{campaign.scheduled_at ? 'Scheduled: ' + new Date(campaign.scheduled_at).toLocaleString('en-US', {
              timeZone: campaign.timezone
            }) + ' · ' + campaign.timezone : 'Not scheduled'}</p><div className="campaign-toolbar">{editable && permitted('send') && <button className="primary-action" onClick={() => {
              setEditing(true);
              setStep(5);
            }}>Send / Schedule</button>}{['SENDING', 'SCHEDULED'].includes(campaign.status) && permitted('cancel') && <button onClick={() => run(() => action('pause'))}>Pause</button>}{campaign.status === 'FAILED' && permitted('send') && <button onClick={() => run(() => action('retry'))}>Retry safe failures</button>}{campaign.status === 'PAUSED' && permitted('send') && <button onClick={() => run(() => action('resume'))}>Resume</button>}{['DRAFT', 'READY', 'SENDING', 'SCHEDULED', 'PAUSED'].includes(campaign.status) && permitted('cancel') && <button onClick={() => setConfirm('cancel')}>Cancel unsent recipients</button>}{['DRAFT', 'READY', 'SENT', 'FAILED', 'CANCELLED'].includes(campaign.status) && permitted('edit') && <button onClick={()=>askLifecycle('archive',campaign)}>Archive</button>}{campaign.can_delete && permitted('edit') && <button onClick={()=>askLifecycle('delete',campaign)}>Delete draft</button>}</div></>}
 {tab === 'Recipients' && <Table heads={['Recipient', 'Company', 'Email', 'Status', 'Sent', 'Delivered', 'Opened (estimated)', 'Clicked', 'Interested', 'Last Activity', 'Failure']}>{campaign.recipients.map(r => <tr key={r.id}><td>{r.first_name} {r.last_name}</td><td>{r.company}</td><td>{r.email}</td><td>{r.status}</td><td>{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</td><td>Unavailable</td><td>{r.opened_at?new Date(r.opened_at).toLocaleString():r.tracking_enabled?'—':'Unavailable'}</td><td>{r.clicked_at?new Date(r.clicked_at).toLocaleString():r.tracking_enabled?'—':'Unavailable'}</td><td>{r.interested_at ? 'Yes' : '—'}</td><td>{new Date(r.interested_at||r.clicked_at||r.opened_at||r.failed_at||r.sent_at||r.queued_at||r.created_at).toLocaleString()}</td><td>{r.failure_message || '—'}</td></tr>)}</Table>}
 {tab === 'Interested' && <><Table heads={['Name', 'Company', 'Package', 'Date', 'Time', 'Location', 'Submitted', 'Lead status', 'Owner', 'Next step']}>{campaign.interests.map(r => <tr key={r.id}><td>{r.first_name} {r.last_name}</td><td>{r.company}</td><td>{campaign.content_json.offers?.find(o=>o.key===r.package)?.name||r.package}</td><td>{r.event_date}</td><td>{r.event_time}</td><td>{r.location || '—'}</td><td>{new Date(r.submitted_at).toLocaleString()}</td><td>{r.lead_status || 'Prospect'}</td><td>{r.owner || 'Unassigned'}</td><td>{r.lead_id ? <Link to={'/sales/leads/' + r.lead_id}>Open lead</Link> : r.client_id ? <Link to={'/sales/clients/' + r.client_id}>Open contact</Link> : can('write:sales') && <button onClick={() => run(async () => {
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
 {tab === 'Settings' && <><p>Sender: {campaign.sender_name} {campaign.sender_email && ` <${campaign.sender_email}>`}</p><p>Reply to: {campaign.reply_to}</p><p>Timezone: {campaign.timezone}</p><p>Channel: Email</p><p>Format: {campaign.content_json.format==='TEXT'?'Text campaign':campaign.content_json.format==='HTML'?'HTML campaign':'2026 Corporate Year-End Celebration'}</p><p>Mailing address: {campaign.content_json.mailing_address || 'Required before sending'}</p></>}
 </div></>}
 {preview && <><p>Preview subject: {preview.subject}</p><iframe sandbox="" title="Personalized campaign preview" srcDoc={preview.html} className="campaign-preview" style={{
        width: mobile ? 375 : 680
      }} /></>}
 {confirm && <div className="campaign-confirmation"><div ref={confirmationRef} onKeyDown={e=>{if(e.key==='Escape'&&!busy)setConfirm(null);if(e.key==='Tab'){const buttons=[...e.currentTarget.querySelectorAll('button:not(:disabled)')];const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}} role="dialog" aria-modal="true" aria-labelledby="campaign-confirm" className="campaign-panel"><h2 id="campaign-confirm">{confirm === 'delete' ? 'Delete this draft campaign?' : confirm === 'archive' ? 'Archive this campaign?' : confirm === 'cancel' ? 'Cancel unsent recipients?' : 'You are about to ' + (confirm === 'schedule' ? 'schedule' : 'send') + ' this campaign'}</h2><p>{['archive','delete'].includes(confirm) ? lifecycleTarget?.name : draft.name} · {lifecycleTarget?.metrics?.recipients ?? lifecycleTarget?.recipients ?? audience?.count ?? 0} recipients</p>{['archive','delete'].includes(confirm) ? <p>{confirm==='delete'?'Only unsent drafts can be deleted. This removes the draft from campaigns and prevents it from being sent. Contacts and unsubscribe preferences are preserved.':'The campaign will move out of the active list. Its sending history remains available under Archived. Previously sent emails cannot be recalled.'}</p> : <><p>Sender: {draft.sender_name}<br />Subject: {draft.subject}</p><p>Already claimed messages may finish. Paused or cancelled campaigns will not claim additional recipients.</p></>}<div className="campaign-toolbar"><button disabled={busy} onClick={() => {setConfirm(null);setSelectedCampaign(null);}}>Go back</button><button disabled={busy} className="primary-action" onClick={() => run(async () => {
          if (['archive','delete'].includes(confirm)) {
            const targetId=lifecycleTarget.id;
            if(confirm==='delete') await api.delete('/campaigns/'+targetId);else await api.post('/campaigns/'+targetId+'/archive',{});
            setConfirm(null);setSelectedCampaign(null);
            if(id && confirm==='delete'){setCampaign(null);navigate('/communications/campaigns');}else await refresh();
            setNotice(confirm==='delete'?'Draft campaign deleted.':'Campaign archived.');
          } else if (confirm === 'cancel') await action('cancel');else {
            await api.post('/campaigns/' + id + '/' + confirm, confirm === 'schedule' ? {
              scheduled_at: zonedSchedule(schedule, draft.timezone)
            } : {});
            setConfirm(null);
            setEditing(false);
            await refresh();
            setNotice('Campaign queued. The worker will process eligible recipients.');
          }
        })}>{confirm === 'delete' ? 'Delete draft' : confirm === 'archive' ? 'Archive campaign' : confirm === 'cancel' ? 'Cancel campaign' : confirm === 'schedule' ? 'Schedule campaign' : 'Send campaign'}</button></div></div></div>}
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
