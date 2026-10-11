import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Link } from 'react-router-dom';
import { LineChart, Line, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { formatTimestamp } from '../utils/display.js';
export default function WebsiteAnalytics() {
  const {
    can
  } = useAuth();
  const [range, setRange] = useState('mtd'),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [data, setData] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  async function load() {
    setError('');
    try {
      setData(await api.get(`/integrations/website-analytics?${new URLSearchParams({
        range,
        ...(range === 'custom' ? {
          from,
          to
        } : {})
      })}`));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (range !== 'custom' || from && to) load();
  }, [range, from, to, revision]);
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      await api.post('/integrations/google-analytics/sync', {
        range,
        from,
        to
      });
      setRevision(x => x + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const r = data?.report;
  return <section className="website-analytics"><div className="page-heading"><div><h2>Website & marketing analytics</h2><p>Google Analytics reporting with campaign-level CRM inquiry counts.</p></div>{can('write:integrations') && <button disabled={busy} onClick={refresh}>Refresh reports</button>}</div><div className="button-row">{[['today', 'Today'], ['week', 'This Week'], ['mtd', 'Month to Date'], ['ytd', 'Year to Date'], ['custom', 'Custom']].map(([v, n]) => <button key={v} aria-pressed={range === v} onClick={() => setRange(v)}>{n}</button>)}{range === 'custom' && <><label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Through<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></>}</div>{error && <p role="alert">{error}</p>}{data?.state === 'NOT_CONNECTED' && <p>{data.message} <Link to="/system/integrations">Open integrations</Link></p>}{data?.state === 'QUEUED' && <p role="status">The first report is queued. <button onClick={() => setRevision(x => x + 1)}>Check progress</button></p>}{r && <><p>{r.property} · {r.dates.startDate} through {r.dates.endDate} · Updated {formatTimestamp(data.refreshed_at)} {data.stale && '· Refresh queued'}</p><div className="kpi-grid compact">{[['Users', r.summary.activeUsers], ['Sessions', r.summary.sessions], ['Engaged Sessions', r.summary.engagedSessions], ['Engagement Rate', percent(r.summary.engagementRate)], ['Conversions (GA key events)', r.summary.keyEvents], ['Inquiry Events', r.summary.inquiryEvents], ['Conversion Rate', percent(r.summary.sessionKeyEventRate)]].map(([n, v]) => <article className="kpi" key={n}><span>{n}</span><strong>{v ?? 0}</strong></article>)}</div><p className="note-text">{r.attributionNote} Inquiry event: {r.inquiryEvent}. {r.truncated && 'Reports contain the first 10,000 rows; totals and detailed rows may differ.'}</p><section className="panel chart-panel"><h3>Traffic over time</h3><ResponsiveContainer width="100%" height={250}><LineChart data={r.traffic}><CartesianGrid stroke="#eee8df" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Line dataKey="sessions" stroke="var(--chart-0, #947133)" /><Line dataKey="activeUsers" stroke="var(--chart-1, #536685)" /></LineChart></ResponsiveContainer></section><ReportTable title="Traffic sources & channels" rows={r.sources} columns={['sessionSource', 'sessionMedium', 'sessionDefaultChannelGroup', 'sessions', 'activeUsers', 'keyEvents']} /><ReportTable title="Campaign performance" rows={r.campaigns.map(c => ({
        ...c,
        crmConversionRate: percent(c.crmConversionRate)
      }))} columns={['sessionCampaignName', 'sessionSource', 'sessionMedium', 'sessions', 'inquiryEvents', 'crmInquiries', 'crmConversionRate']} />{r.crmOnlyCampaigns.length > 0 && <ReportTable title="CRM campaigns without matching GA sessions" rows={r.crmOnlyCampaigns} columns={['campaign', 'source', 'medium', 'inquiries']} />}<ReportTable title="Top landing pages" rows={r.landing} columns={['landingPagePlusQueryString', 'sessions']} /><ReportTable title="Top pages" rows={r.pages} columns={['pagePath', 'screenPageViews']} />{r.contentUnavailable ? <p>UTM content reporting is unavailable for this property.</p> : <ReportTable title="UTM content" rows={r.contents} columns={['sessionManualAdContent', 'sessions']} />}</>}</section>;
}
function percent(v) {
  return v == null ? 'Unavailable' : `${(Number(v) * 100).toFixed(1)}%`;
}
function ReportTable({
  title,
  rows,
  columns
}) {
  return <section className="panel"><h3>{title}</h3><div className="table-wrap"><table><thead><tr>{columns.map(c => <th key={c}>{c.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((r, i) => <tr key={i}>{columns.map(c => <td key={c}>{r[c] ?? 'Unavailable'}</td>)}</tr>)}</tbody></table></div>{!rows.length && <p>No data in this period.</p>}{rows.length > 100 && <p>Showing the first 100 rows.</p>}</section>;
}
