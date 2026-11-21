import {previousAnalyticsDates,websiteAnalyticsInsights,analyticsPageRows} from '../../../shared/website-analytics-insights.js';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { getBusinessDateRanges } from '../utils/date-ranges.js';
import { digest, memberHash, memberUpdate } from './external-provider-security.js';
import { providerApi } from './external-provider-adapters.js';
import { connection, queueExternal } from './external-connections-service.js';
export function analyticsDates(input = {}, timeZone = 'America/Chicago', now = new Date()) {
  let startDate, endDate;
  if (input.range === 'custom') {
    startDate = input.from;
    endDate = input.to;
    for (const d of [startDate, endDate]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || !Number.isFinite(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) throw new AppError('Choose valid start and end dates.', 422, 'INVALID_DATE_RANGE');
    if (startDate > endDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 366) throw new AppError('Choose a date range of up to one year.', 422, 'INVALID_DATE_RANGE');
  } else {
    const ranges = getBusinessDateRanges({
        timeZone,
        now
      }),
      r = ranges[input.range || 'mtd'];
    if (!r) throw new AppError('Unknown date range.', 422, 'INVALID_DATE_RANGE');
    startDate = r.startDate;
    endDate = new Date(Date.parse(`${r.endDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    // This Week is week-to-date for external analytics, avoiding future dates.
    if (endDate > ranges.today.startDate) endDate = ranges.today.startDate;
  }
  return {
    startDate,
    endDate,
    timeZone
  };
}
export function reportRows(report) {
  return (report.rows || []).map(row => Object.fromEntries([...(report.dimensionHeaders || []).map((h, i) => [h.name, row.dimensionValues?.[i]?.value || '']), ...(report.metricHeaders || []).map((h, i) => [h.name, Number(row.metricValues?.[i]?.value || 0)])]));
}
export function reportKey(dates, event) {
  return digest(JSON.stringify({
    ...dates,
    event, schema:2
  }));
}
export async function websiteReport(input = {}, req = null) {
  const row = await connection('GA4');
  if (!row.encrypted_credentials || row.metadata.needs_selection || row.status === 'DISABLED') return {
    state: 'NOT_CONNECTED',
    message: 'Connect Google Analytics and select a property in System → Integrations.'
  };
  const dates = analyticsDates(input, row.metadata.time_zone || 'America/Chicago'),
    event = row.metadata.primary_inquiry_event || 'generate_lead',
    key = reportKey(dates, event);
  const cache = (await query('SELECT report,refreshed_at FROM integration_report_cache WHERE connection_id=$1 AND cache_key=$2', [row.id, key])).rows[0];
  let job = null;
  if (!cache || Date.now() - new Date(cache.refreshed_at).getTime() > 900000) job = await queueExternal('GA4', 'REPORT_REFRESH', {
    dates,
    event,
    cache_key: key
  }, req);
  return {
    state: cache ? 'AVAILABLE' : job?.status==='FAILED'?'FAILED':'QUEUED',
    message:job?.status==='FAILED'?'The Google report refresh failed. Check the connection and retry.':undefined,
    report: cache?.report?{...cache.report,landing:analyticsPageRows(cache.report.landing),pages:analyticsPageRows(cache.report.pages,'pagePath','screenPageViews')}:undefined,
    refreshed_at: cache?.refreshed_at,
    stale: Boolean(cache && job),
    job,
    dates
  };
}
export async function refreshAnalytics(row, tokens, payload) {
  const {
      dates,
      event,
      cache_key
    } = payload,
    base = `/v1beta/properties/${row.metadata.property_id}:runReport`;
  const report = async (dimensions, metrics, filter, period=dates) => {
    const r = await providerApi('GA4', tokens, base, {
      method: 'POST',
      body: {
        dateRanges: [{
          startDate: period.startDate,
          endDate: period.endDate
        }],
        dimensions: dimensions.map(name => ({
          name
        })),
        metrics: metrics.map(name => ({
          name
        })),
        limit: '10000',
        orderBys: dimensions.includes('date') ? [{
          dimension: {
            dimensionName: 'date'
          }
        }] : [{
          metric: {
            metricName: metrics[0]
          },
          desc: true
        }],
        ...(filter ? {
          dimensionFilter: filter
        } : {})
      }
    });
    return {
      rows: reportRows(r),
      truncated: (r.rowCount || 0) > 10000
    };
  };
  const eventFilter = {
    filter: {
      fieldName: 'eventName',
      stringFilter: {
        matchType: 'EXACT',
        value: event
      }
    }
  };
  const summary = await report([], ['activeUsers', 'sessions', 'engagedSessions', 'engagementRate', 'keyEvents', 'sessionKeyEventRate']);
  const inquiries = await report([], ['eventCount'], eventFilter);
  const previousDates=previousAnalyticsDates(dates);
  const previousSummary=await report([],['sessions','activeUsers'],null,previousDates);
  const previousInquiries=await report([],['eventCount'],eventFilter,previousDates);
  const interest=await report(['eventName'],['eventCount'],{filter:{fieldName:'eventName',stringFilter:{matchType:'FULL_REGEXP',value:'select_experience_(glam|360|mirror|vogue|virtual|audio)'}}});
  const traffic = await report(['date'], ['sessions', 'activeUsers']);
  const sources = await report(['sessionSource', 'sessionMedium', 'sessionDefaultChannelGroup'], ['sessions', 'activeUsers', 'keyEvents']);
  const campaigns = await report(['sessionCampaignName', 'sessionSource', 'sessionMedium'], ['sessions', 'keyEvents']);
  const inquiryCampaigns = await report(['sessionCampaignName', 'sessionSource', 'sessionMedium'], ['eventCount'], eventFilter);
  const landing = await report(['landingPagePlusQueryString'], ['sessions']);
  const pages = await report(['pagePath'], ['screenPageViews']);
  // UTM content is sessionManualAdContent; some properties do not expose it.
  let contents = {
    rows: [],
    unavailable: true
  };
  try {
    contents = await report(['sessionManualAdContent'], ['sessions']);
  } catch (e) {
    if (e.code !== 'PROVIDER_REJECTED') throw e;
  }
  const crm = await query(`SELECT COALESCE(utm_campaign,first_touch->>'utm_campaign','(unattributed)') AS campaign,
 COALESCE(utm_source,first_touch->>'utm_source','(unattributed)') AS source,COALESCE(utm_medium,first_touch->>'utm_medium','(unattributed)') AS medium,count(*)::int AS inquiries,
 COALESCE(sum(b.bookings),0)::int AS bookings,COALESCE(sum(b.booking_value),0)::numeric AS booking_value
 FROM leads l LEFT JOIN LATERAL (SELECT count(*)::int bookings,COALESCE(sum(total),0) booking_value FROM bookings WHERE lead_id=l.id AND deleted_at IS NULL) b ON true
 WHERE l.deleted_at IS NULL AND l.test_mode=false AND l.created_at >= ($1::date::timestamp AT TIME ZONE $3) AND l.created_at < (($2::date+1)::timestamp AT TIME ZONE $3) GROUP BY 1,2,3`, [dates.startDate, dates.endDate, dates.timeZone]);
  const crmSummary=crm.rows.reduce((sum,row)=>({inquiries:sum.inquiries+Number(row.inquiries||0),bookings:sum.bookings+Number(row.bookings||0),bookingValue:sum.bookingValue+Number(row.booking_value||0)}),{inquiries:0,bookings:0,bookingValue:0});
  // Store paths, never query strings which can contain visitor-entered data.
  const landingPaths=analyticsPageRows(landing.rows.map(row=>({landingPage:row.landingPagePlusQueryString,sessions:row.sessions})));
  const performance = campaigns.rows.map(c => {
    const match = x => x.campaign === c.sessionCampaignName && x.source === c.sessionSource && x.medium === c.sessionMedium;
    const lead = crm.rows.find(match),
      events = inquiryCampaigns.rows.find(x => x.sessionCampaignName === c.sessionCampaignName && x.sessionSource === c.sessionSource && x.sessionMedium === c.sessionMedium);
    return {
      ...c,
      crmInquiries: lead?.inquiries || 0,
      crmBookings:Number(lead?.bookings||0),crmBookingValue:Number(lead?.booking_value||0),
      inquiryEvents: events?.eventCount || 0,
      crmConversionRate: c.sessions ? (lead?.inquiries || 0) / c.sessions : null
    };
  });
  const reportData = {
    provider: 'GA4',
    property: row.metadata.property_name,
    dates,
    inquiryEvent: event,
    summary: {
      ...summary.rows[0],
      inquiryEvents: inquiries.rows[0]?.eventCount || 0
    },
    previous:{dates:previousDates,summary:{...previousSummary.rows[0],inquiryEvents:previousInquiries.rows[0]?.eventCount||0}},
    crmSummary,
    experienceInterest:interest.rows.filter(r=>/^select_experience_(glam|360|mirror|vogue|virtual|audio)$/.test(r.eventName)).map(r=>({experience:r.eventName.replace('select_experience_',''),selections:r.eventCount})),
    traffic: traffic.rows,
    sources: sources.rows,
    campaigns: performance,
    landing:landingPaths,
    pages:analyticsPageRows(pages.rows,'pagePath','screenPageViews'),
    contents: contents.rows,
    contentUnavailable: Boolean(contents.unavailable),
    crmOnlyCampaigns: crm.rows.filter(x => !campaigns.rows.some(c => x.campaign === c.sessionCampaignName && x.source === c.sessionSource && x.medium === c.sessionMedium)),
    truncated: [summary, inquiries, traffic, sources, campaigns, landing, pages].some(x => x.truncated),
    cohortNote:'CRM totals describe inquiries received in this date range and their related booking records to date. Booking value is not collected revenue. It is not a person-level match to Google visitors.',
    attributionNote: 'GA event counts and CRM inquiries are separate measurements. Matching is aggregated by campaign/source/medium, not by person.'
  };
  reportData.insights=websiteAnalyticsInsights(reportData);
  await query('INSERT INTO integration_report_cache(connection_id,cache_key,report) VALUES($1,$2,$3) ON CONFLICT(connection_id,cache_key) DO UPDATE SET report=EXCLUDED.report,refreshed_at=now()', [row.id, cache_key, reportData]);
  return {
    records_processed: performance.length,
    cache_key
  };
}
export async function syncMailchimp(row, tokens, job) {
  const audience = row.metadata.audience_id;
  if (!audience) throw new AppError('Select a Mailchimp audience.', 422, 'PROVIDER_SELECTION_REQUIRED');
  const summary = job.payload.summary || {
    records_processed: 0,
    records_created: 0,
    records_updated: 0,
    records_skipped: 0,
    records_failed: 0
  };
  let cursor = job.payload.cursor || '';
  // Bound each worker turn; queue continuation without holding the API request open.
  const contacts = (await query(`WITH contacts AS (
 SELECT lower(email) AS email,first_name,last_name,company,phone,status::text AS lifecycle,lead_source AS source,marketing_email_opt_in,marketing_opted_out_at FROM leads WHERE deleted_at IS NULL AND test_mode=false AND email IS NOT NULL
 UNION ALL SELECT lower(email),split_part(name,' ',1),substring(name from position(' ' in name)+1),company,phone,'CLIENT',NULL,marketing_email_opt_in,marketing_opted_out_at FROM clients WHERE deleted_at IS NULL AND email IS NOT NULL
 ) SELECT DISTINCT ON (email) email,first_name,last_name,company,phone,lifecycle,source FROM contacts c WHERE email>$1 AND marketing_email_opt_in=true AND marketing_opted_out_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM contacts other WHERE other.email=c.email AND (other.marketing_opted_out_at IS NOT NULL OR other.marketing_email_opt_in=false))
 AND NOT EXISTS(SELECT 1 FROM campaign_suppressions s WHERE lower(s.email)=c.email) ORDER BY email,lifecycle LIMIT 50`, [cursor])).rows;
  for (const contact of contacts) {
    const path = `/lists/${audience}/members/${memberHash(contact.email)}`;
    let existing = null;
    try {
      existing = await providerApi('MAILCHIMP', tokens, path);
    } catch (e) {
      if (e.code !== 'PROVIDER_NOT_FOUND') throw e;
    }
    if (existing && existing.status !== 'subscribed') {
      summary.records_skipped++;
    } else {
      // Recheck consent after network read; opt-outs may arrive while bulk sync is running.
      const blocked = await query(`SELECT 1 FROM campaign_suppressions WHERE lower(email)=$1 UNION ALL SELECT 1 FROM leads WHERE lower(email)=$1 AND deleted_at IS NULL AND (marketing_email_opt_in=false OR marketing_opted_out_at IS NOT NULL) UNION ALL SELECT 1 FROM clients WHERE lower(email)=$1 AND deleted_at IS NULL AND (marketing_email_opt_in=false OR marketing_opted_out_at IS NOT NULL) LIMIT 1`, [contact.email]);
      if (blocked.rowCount) summary.records_skipped++;else {
        try {
          await providerApi('MAILCHIMP', tokens, path, {
            method: 'PUT',
            body: memberUpdate(contact, existing, row.metadata.merge_fields || ['FNAME', 'LNAME'])
          });
          await providerApi('MAILCHIMP', tokens, `${path}/tags`, {
            method: 'POST',
            body: {
              tags: [{
                name: `LOLA: ${contact.lifecycle}`,
                status: 'active'
              }, ...(contact.source ? [{
                name: `LOLA source: ${String(contact.source).slice(0, 80)}`,
                status: 'active'
              }] : [])]
            }
          });
          summary[existing ? 'records_updated' : 'records_created']++;
        } catch (error) {
          if (error.providerStatus === 400) summary.records_failed++;else throw error;
        }
      }
    }
    summary.records_processed++;
    cursor = contact.email;
    await query("UPDATE integration_jobs SET payload=jsonb_set(jsonb_set(payload,'{cursor}',to_jsonb($2::text)),'{summary}',$3::jsonb) WHERE id=$1", [job.id, cursor, JSON.stringify(summary)]);
  }
  if (contacts.length === 50) await queueExternal('MAILCHIMP', 'CONTACT_SYNC', {
    cursor,
    summary
  }, null, `${job.id}:next:${digest(cursor)}`);
  await query("UPDATE integration_connections SET metadata=jsonb_set(metadata,'{sync_summary}',$1::jsonb) WHERE id=$2", [JSON.stringify(summary), row.id]);
  return summary;
}
export async function mailchimpReports(row, tokens) {
  const r = await providerApi('MAILCHIMP', tokens, '/reports?count=100');
  const reports = (r.reports || []).map(c => ({
    provider: 'MAILCHIMP',
    id: c.id,
    name: c.campaign_title || c.subject_line,
    sent: c.emails_sent,
    delivered: Math.max(0, (c.emails_sent || 0) - (c.bounces?.hard_bounces || 0) - (c.bounces?.soft_bounces || 0)),
    opens: c.opens?.unique_opens,
    clicks: c.clicks?.unique_subscriber_clicks,
    unsubscribes: c.unsubscribed,
    bounces: (c.bounces?.hard_bounces || 0) + (c.bounces?.soft_bounces || 0)
  }));
  await query("INSERT INTO integration_report_cache(connection_id,cache_key,report) VALUES($1,'mailchimp_campaigns',$2) ON CONFLICT(connection_id,cache_key) DO UPDATE SET report=EXCLUDED.report,refreshed_at=now()", [row.id, {
    reports,
    truncated: r.total_items > 100
  }]);
  return {
    records_processed: reports.length
  };
}
