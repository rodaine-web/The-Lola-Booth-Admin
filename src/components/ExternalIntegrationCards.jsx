import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Instagram, Music2, ChartNoAxesCombined, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import StatusBadge from './StatusBadge.jsx';
import { formatTimestamp } from '../utils/display.js';
const info = {
  META: {
    label: 'Meta / Instagram',
    Icon: Instagram,
    description: 'Facebook and Instagram lead forms flow into your existing sales pipeline.'
  },
  TIKTOK: {
    label: 'TikTok',
    Icon: Music2,
    description: 'Provider approval and verification of the Lead Ads webhook format are required before receiving live leads.'
  },
  GA4: {
    label: 'Google Analytics',
    Icon: ChartNoAxesCombined,
    description: 'Website traffic, inquiry events and campaign performance, with read-only access.'
  },
  MAILCHIMP: {
    label: 'Mailchimp',
    Icon: Mail,
    description: 'Sync subscribed CRM contacts to an audience. Your CRM remains the source of truth.'
  }
};
export default function ExternalIntegrationCards() {
  const {
      can
    } = useAuth(),
    manage = can('write:integrations');
  const [rows, setRows] = useState([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(''),
    [selected, setSelected] = useState(null),
    [options, setOptions] = useState([]),
    [selection, setSelection] = useState(''),
    [event, setEvent] = useState('generate_lead'),
    [logs, setLogs] = useState(null),
    [filter, setFilter] = useState({
      provider: '',
      status: '',
      operation: '',
      event_type: '',
      from: '',
      to: ''
    }),
    [reports, setReports] = useState(null);
  async function load() {
    setRows((await api.get('/integrations/connections')).data);
  }
  useEffect(() => {
    load().catch(e => setError(e.message));
    const state = new URLSearchParams(window.location.search).get('connection');
    if (state) setNotice(state === 'authorized' ? 'Authorization received. Choose the property, audience or account to finish.' : 'Authorization could not be completed. Review the connection and try again.');
  }, []);
  async function run(key, action) {
    setBusy(key);
    setError('');
    try {
      await action();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }
  async function details(row) {
    setSelected(row);
    setOptions([]);
    setSelection(row.account_id || '');
    setEvent(row.metadata.primary_inquiry_event || 'generate_lead');
    setReports(null);
    if (manage) await run(row.provider, async () => setOptions((await api.get(`/integrations/${row.slug}/accounts`)).data));
    if (row.provider === 'MAILCHIMP') api.get('/integrations/mailchimp/reports').then(setReports).catch(e => setError(e.message));
  }
  async function fetchLogs(next = filter) {
    await run('logs', async () => setLogs(await api.get(`/integrations/logs?${new URLSearchParams(Object.entries(next).filter(([, v]) => v))}`)));
  }
  return <section className="integration-section"><h2>External connections</h2><p>Connect each service when its account setup is complete. Sales and LOLA campaigns work independently.</p>{error && <p role="alert" className="error-banner">{error}</p>}{notice && <p role="status" className="toast">{notice}</p>}
 <div className="integration-grid external-grid">{rows.map(row => {
        const {
            label,
            Icon,
            description
          } = info[row.provider],
          active = ['CONNECTED', 'DEGRADED', 'EXPIRED', 'ERROR'].includes(row.status);
        return <article className="panel integration-card" key={row.provider}><div className="integration-heading"><h3><Icon aria-hidden="true" size={25} /> {label}</h3><StatusBadge status={row.approval_pending ? 'PENDING_APPROVAL' : row.status} /></div><p>{description}</p><strong>{row.account_name || 'No account connected'}</strong><p className="integration-health">{row.status === 'CONNECTED' ? <CheckCircle2 aria-hidden="true" size={17} /> : <AlertCircle aria-hidden="true" size={17} />} {row.status === 'CONNECTED' ? 'Healthy' : row.status === 'DEGRADED' && row.metadata.needs_selection ? 'Select an account to finish' : row.approval_pending ? 'Awaiting TikTok Business approval' : 'Setup or attention needed'}</p><dl><dt>Last successful activity</dt><dd>{row.last_sync_at ? formatTimestamp(row.last_sync_at) : 'Not yet verified'}</dd>{['META', 'TIKTOK'].includes(row.provider) && <><dt>Last webhook</dt><dd>{row.last_webhook_at ? formatTimestamp(row.last_webhook_at) : 'None received'}</dd></>}{row.last_error && <><dt>Last error</dt><dd>{row.last_error}</dd></>}</dl>
 <div className="button-row">{manage && <button disabled={Boolean(busy) || !row.configured || row.approval_pending} onClick={() => run(row.provider, async () => {
              const r = await api.get(`/integrations/${row.slug}/connect`);
              window.location.assign(r.url);
            })}>{active ? 'Reconnect' : 'Connect'}</button>}{active && <button disabled={Boolean(busy)} onClick={() => details(row)}>View details</button>}{manage && active && <><button disabled={Boolean(busy) || row.metadata.needs_selection} onClick={() => run(row.provider, async () => {
                await api.post(`/integrations/${row.slug}/test`, {});
                setNotice(`${label} connection verified with the provider.`);
              })}>Test connection</button><button disabled={Boolean(busy) || row.metadata.needs_selection} onClick={() => run(row.provider, async () => {
                await api.post(`/integrations/${row.slug}/sync`, {});
                setNotice(`${label} ${['META', 'TIKTOK'].includes(row.provider) ? 'account refresh' : 'sync'} queued. View logs for progress.`);
              })}>{['META', 'TIKTOK'].includes(row.provider) ? 'Refresh account' : 'Sync now'}</button><button disabled={Boolean(busy)} onClick={() => {
                if (window.confirm(`Disconnect ${label}? Queued syncs will stop.`)) run(row.provider, async () => {
                  await api.post(`/integrations/${row.slug}/disconnect`, {});
                  setNotice(`${label} disconnected.`);
                });
              }}>Disconnect</button></>}<button disabled={Boolean(busy)} onClick={() => {
              const f = {
                ...filter,
                provider: row.provider
              };
              setFilter(f);
              fetchLogs(f);
            }}>View logs</button></div>{!row.configured && <p className="note-text">Server credentials have not been configured. Follow the external integrations setup guide.</p>}{row.provider === 'GA4' && <Link to="/insights/analytics?report=website">View website analytics</Link>}</article>;
      })}</div>
 {selected && <section className="panel integration-detail"><div className="page-heading"><h3>{info[selected.provider].label} details</h3><button onClick={() => setSelected(null)}>Close details</button></div><p>Account: {selected.account_name}</p><p>Permissions: {selected.scopes.join(', ') || 'Provider-managed permissions'}</p><p>Authorization expires: {selected.token_expires_at ? formatTimestamp(selected.token_expires_at) : 'No expiry returned by provider; access may still be revoked.'}</p>{selected.metadata.instagram_username && <p>Instagram: @{selected.metadata.instagram_username}</p>}{manage && <><label>Choose {selected.provider === 'GA4' ? 'GA4 property' : selected.provider === 'MAILCHIMP' ? 'audience' : 'account'}<select value={selection} onChange={e => setSelection(e.target.value)}><option value="">Select an authorized account</option>{options.map(o => <option key={o.id} value={o.id}>{o.account_name ? `${o.account_name} / ` : ''}{o.name}{o.members != null ? ` (${o.members} members)` : ''}</option>)}</select></label><button disabled={!selection || Boolean(busy)} onClick={() => run(selected.provider, async () => {
          const r = await api.post(`/integrations/${selected.slug}/account`, {
            id: selection
          });
          setSelected(r);
          setNotice('Selection verified and saved.');
        })}>Save selection</button>{selected.provider === 'GA4' && <><label>Primary inquiry conversion event<input value={event} onChange={e => setEvent(e.target.value)} maxLength={40} /></label><button disabled={Boolean(busy)} onClick={() => run('event', async () => {
            await api.patch('/integrations/google-analytics/settings', {
              primary_inquiry_event: event
            });
            setNotice('Inquiry event saved. Refresh analytics to use it.');
          })}>Save inquiry event</button></>}</>}{selected.metadata.sync_summary && <p>Last sync: {selected.metadata.sync_summary.records_created} added · {selected.metadata.sync_summary.records_updated} updated · {selected.metadata.sync_summary.records_skipped} skipped · {selected.metadata.sync_summary.records_failed} failed</p>}{selected.provider === 'MAILCHIMP' && <><h4>Mailchimp campaigns</h4><p>These results come from Mailchimp and are separate from LOLA campaign results.</p>{manage && <button disabled={Boolean(busy)} onClick={() => run('reports', async () => {
          await api.post('/integrations/mailchimp/sync', {
            operation: 'reports'
          });
          setNotice('Mailchimp report refresh queued. Reopen details when complete.');
        })}>Refresh Mailchimp reports</button>}<div className="table-wrap"><table><thead><tr>{['Campaign', 'Sent', 'Delivered', 'Opens', 'Clicks', 'Unsubscribes', 'Bounces'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{reports?.report?.reports?.map(r => <tr key={r.id}>{['name', 'sent', 'delivered', 'opens', 'clicks', 'unsubscribes', 'bounces'].map(k => <td key={k}>{r[k] ?? 'Unavailable'}</td>)}</tr>)}</tbody></table></div></>}</section>}
 {logs && <section className="panel"><div className="page-heading"><h3>Integration logs</h3><button onClick={() => setLogs(null)}>Close logs</button></div><form className="integration-filters" onSubmit={e => {
        e.preventDefault();
        fetchLogs();
      }}>{Object.keys(filter).map(key => <label key={key}>{key.replaceAll('_', ' ')}{['from', 'to'].includes(key) ? <input type="date" value={filter[key]} onChange={e => setFilter({
            ...filter,
            [key]: e.target.value
          })} /> : key === 'provider' ? <select value={filter.provider} onChange={e => setFilter({
            ...filter,
            provider: e.target.value
          })}><option value="">All providers</option>{Object.keys(info).map(p => <option key={p}>{p}</option>)}</select> : <input value={filter[key]} onChange={e => setFilter({
            ...filter,
            [key]: e.target.value
          })} />}</label>)}<button disabled={Boolean(busy)}>Filter</button></form><h4>Sync jobs</h4><div className="table-wrap"><table><thead><tr><th>Provider</th><th>Operation</th><th>Status</th><th>Attempts</th><th>Started</th><th>Completed</th><th>Error</th><th>Action</th></tr></thead><tbody>{logs.jobs.map(j => <tr key={j.id}><td>{j.provider}</td><td>{j.operation}</td><td>{j.status}</td><td>{j.attempts}</td><td>{j.started_at ? formatTimestamp(j.started_at) : 'Queued'}</td><td>{j.completed_at ? formatTimestamp(j.completed_at) : '—'}</td><td>{j.last_error || '—'}</td><td>{manage && j.status === 'FAILED' && <button disabled={Boolean(busy)} onClick={() => run(j.id, async () => {
                  await api.post(`/integrations/jobs/${j.id}/retry`, {});
                  setNotice('Job queued for retry.');
                })}>Retry</button>}</td></tr>)}</tbody></table></div><h4>Webhook delivery</h4>{logs.webhooks.map(w => <p key={w.id}>{w.provider} · {w.event_type} · {w.status} · {formatTimestamp(w.received_at)} · {w.attempt_count} attempts {w.last_error && `· ${w.last_error}`}</p>)}{!logs.jobs.length && !logs.webhooks.length && <p>No matching activity.</p>}<h4>Processing summaries</h4>{logs.attempts.map(a => <p key={a.id}>{a.provider} · {a.operation} · {a.result} · {Object.entries(a.response_summary || {}).filter(([k]) => k.startsWith('records_')).map(([k, v]) => `${k.replaceAll('_', ' ')}: ${v}`).join(' · ')}</p>)}</section>}
 </section>;
}
