import { query } from "../db/pool.js";
import { getBusinessDateRanges, toSqlRange } from "../utils/date-ranges.js";

const rangeLabels = {
  today: "Today at LOLA",
  week: "This Week at LOLA",
  mtd: "LOLA Month to Date",
  ytd: "LOLA Year to Date"
};

const comparisonForRange = {
  today: "previousDay",
  week: "previousWeek",
  mtd: "equivalentPriorMonthPeriod",
  ytd: "sameYtdPeriodPreviousYear"
};

export async function getOperationalDashboard({ range = "today", user } = {}) {
  const settings = await getOperationalSettings();
  const ranges = getBusinessDateRanges({ timeZone: settings.timezone, weekStart: settings.business_week_start });
  const selected = ranges[range] || ranges.today;
  const comparison = ranges.comparisons[comparisonForRange[range] || "previousDay"];
  const params = rangeParams(selected);
  const comparisonParams = rangeParams(comparison);
  const [current, previous, lists, trends, funnel, leadSources, performers] = await Promise.all([
    dashboardMetrics(params),
    dashboardMetrics(comparisonParams),
    dashboardLists(params, range, user),
    revenueTrend(params, range),
    salesFunnel(params),
    leadSourcePerformance(params),
    topPerformers(params)
  ]);

  return {
    range,
    label: rangeLabels[range] || rangeLabels.today,
    timeZone: settings.timezone,
    sqlRange: toSqlRange(selected),
    comparisonRange: toSqlRange(comparison),
    generatedAt: new Date().toISOString(),
    groups: groupMetrics(current, previous),
    trends,
    funnel,
    leadSources,
    topPerformers: performers,
    ...lists,
    metricDefinitions: metricDefinitions()
  };
}

export async function getOperationalCalendar({ view = "month", date, filters = {}, user } = {}) {
  const settings = await getOperationalSettings();
  const anchor = date ? new Date(`${date}T12:00:00`) : new Date();
  const ranges = calendarRanges(anchor, settings.timezone, settings.business_week_start);
  const selected = ranges[view] || ranges.month;
  const params = [selected.startDate, selected.endDate];
  const where = ["e.deleted_at IS NULL", "e.event_date BETWEEN $1::date AND $2::date"];
  addFilter(where, params, "e.status", filters.status);
  addFilter(where, params, "e.experience_id", filters.experienceId);
  addFilter(where, params, "e.package_id", filters.packageId);
  addFilter(where, params, "e.event_type", filters.eventType);
  addFilter(where, params, "e.venue_name", filters.venue);
  addFilter(where, params, "e.city", filters.city);
  if (filters.staffId) {
    params.push(filters.staffId);
    where.push(`EXISTS (SELECT 1 FROM staff_assignments sa WHERE sa.event_id=e.id AND sa.released_at IS NULL AND sa.staff_profile_id=$${params.length})`);
  }
  if (filters.equipmentId) {
    params.push(filters.equipmentId);
    where.push(`EXISTS (SELECT 1 FROM equipment_assignments ea WHERE ea.event_id=e.id AND ea.released_at IS NULL AND ea.equipment_id=$${params.length})`);
  }
  if (user?.roles?.includes("ATTENDANT") && !user.roles.includes("OWNER") && !user.roles.includes("ADMIN")) {
    params.push(user.id);
    where.push(`EXISTS (SELECT 1 FROM staff_assignments sa JOIN staff_profiles sp ON sp.id=sa.staff_profile_id WHERE sa.event_id=e.id AND sa.released_at IS NULL AND sp.user_id=$${params.length})`);
  }
  const events = await query(
    `SELECT e.id, e.event_name, e.event_date, e.start_time, e.end_time, e.setup_time, e.breakdown_time, e.venue_name, e.venue_address, e.city, e.state,
      e.status, e.event_type, e.guest_count, e.parking_loading_instructions, e.power_requirements, e.wifi_notes, e.backdrop, e.print_template,
      c.name AS client_name, c.email AS client_email, c.phone AS client_phone, x.name AS experience_name, p.name AS package_name,
      b.payment_status, b.balance_due, b.total,
      COALESCE(sa.staff_count,0)::int AS staff_count,
      COALESCE(ea.equipment_count,0)::int AS equipment_count
     FROM events e
     LEFT JOIN clients c ON c.id=e.client_id
     LEFT JOIN experiences x ON x.id=e.experience_id
     LEFT JOIN packages p ON p.id=e.package_id
     LEFT JOIN bookings b ON b.event_id=e.id AND b.deleted_at IS NULL
     LEFT JOIN (SELECT event_id, count(*) AS staff_count FROM staff_assignments WHERE released_at IS NULL GROUP BY event_id) sa ON sa.event_id=e.id
     LEFT JOIN (SELECT event_id, count(*) AS equipment_count FROM equipment_assignments WHERE released_at IS NULL GROUP BY event_id) ea ON ea.event_id=e.id
     WHERE ${where.join(" AND ")}
     ORDER BY e.event_date, COALESCE(e.start_time, '00:00'::time)`,
    params
  );
  const readiness = await readinessForEvents(events.rows);
  return {
    view,
    timeZone: settings.timezone,
    range: selected,
    filters,
    legend: calendarLegend(),
    events: events.rows.map((event) => decorateCalendarEvent(event, readiness[event.id] || []))
  };
}

async function getOperationalSettings() {
  const settings = await query("SELECT timezone, business_week_start, default_equipment_turnaround_buffer_minutes, default_staff_travel_buffer_minutes FROM business_settings LIMIT 1");
  return {
    timezone: settings.rows[0]?.timezone || "America/Chicago",
    business_week_start: Number(settings.rows[0]?.business_week_start ?? 1),
    equipmentBufferMinutes: Number(settings.rows[0]?.default_equipment_turnaround_buffer_minutes || 30),
    staffBufferMinutes: Number(settings.rows[0]?.default_staff_travel_buffer_minutes || 30)
  };
}

function rangeParams(range) {
  return [range.start.toISOString(), range.end.toISOString()];
}

async function dashboardMetrics([start, end]) {
  const result = await query(
    `SELECT
      (SELECT count(*)::int FROM leads WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL) AS new_leads,
      (SELECT count(*)::int FROM leads WHERE COALESCE(received_at, created_at) >= $1 AND COALESCE(received_at, created_at) < $2 AND provider IN ('META','TIKTOK','LINKEDIN') AND deleted_at IS NULL AND test_mode=false) AS new_social_leads,
      (SELECT count(*)::int FROM leads WHERE first_contacted_at IS NULL AND status NOT IN ('WON','LOST','ARCHIVED') AND deleted_at IS NULL) AS leads_awaiting_response,
      (SELECT COALESCE(avg(response_time_minutes),0)::numeric FROM leads WHERE first_contacted_at >= $1 AND first_contacted_at < $2 AND response_time_minutes IS NOT NULL AND deleted_at IS NULL) AS average_first_response_time,
      (SELECT count(*)::int FROM webhook_events WHERE received_at >= $1 AND received_at < $2 AND status IN ('FAILED','FAILED_NEEDS_REVIEW')) AS failed_integration_events,
      (SELECT count(*)::int FROM leads WHERE updated_at >= $1 AND updated_at < $2 AND status IN ('QUALIFIED','PROPOSAL_DRAFT','PROPOSAL_SENT','WON') AND deleted_at IS NULL) AS qualified_leads,
      (SELECT count(*)::int FROM proposals WHERE sent_at >= $1 AND sent_at < $2 AND deleted_at IS NULL) AS proposals_sent,
      (SELECT count(*)::int FROM proposals WHERE accepted_at >= $1 AND accepted_at < $2 AND deleted_at IS NULL) AS proposals_accepted,
      (SELECT count(*)::int FROM leads WHERE updated_at >= $1 AND updated_at < $2 AND status='WON' AND deleted_at IS NULL) AS bookings_won,
      (SELECT COALESCE(sum(total),0)::numeric FROM bookings WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL) AS booked_revenue,
      (SELECT COALESCE(sum(amount - refunded_amount),0)::numeric FROM payments WHERE COALESCE(paid_at, payment_date::timestamptz, created_at) >= $1 AND COALESCE(paid_at, payment_date::timestamptz, created_at) < $2 AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') AND deleted_at IS NULL) AS collected_revenue,
      (SELECT COALESCE(sum(refunded_amount),0)::numeric FROM payments WHERE COALESCE(paid_at, payment_date::timestamptz, created_at) >= $1 AND COALESCE(paid_at, payment_date::timestamptz, created_at) < $2 AND deleted_at IS NULL) AS refunds,
      (SELECT COALESCE(sum(deposit_required),0)::numeric FROM bookings WHERE created_at >= $1 AND created_at < $2 AND amount_paid > 0 AND deleted_at IS NULL) AS deposits_collected,
      (SELECT COALESCE(sum(COALESCE(amount_outstanding,balance_due)),0)::numeric FROM invoices WHERE deleted_at IS NULL AND status <> 'VOID') AS outstanding_balance,
      (SELECT COALESCE(sum(COALESCE(amount_outstanding,balance_due)),0)::numeric FROM invoices WHERE deleted_at IS NULL AND status <> 'VOID' AND due_date >= current_date AND due_date < current_date + interval '7 days') AS due_this_week,
      (SELECT COALESCE(sum(COALESCE(amount_outstanding,balance_due)),0)::numeric FROM invoices WHERE deleted_at IS NULL AND status <> 'VOID' AND due_date < current_date AND COALESCE(amount_outstanding,balance_due) > 0) AS overdue_balance,
      (SELECT count(*)::int FROM events WHERE event_date >= $1::date AND event_date < $2::date AND deleted_at IS NULL) AS events_scheduled,
      (SELECT count(*)::int FROM events WHERE event_date >= $1::date AND event_date < $2::date AND status='COMPLETED' AND deleted_at IS NULL) AS events_completed,
      (SELECT count(*)::int FROM events WHERE event_date >= current_date AND event_date < $2::date AND status <> 'CANCELLED' AND deleted_at IS NULL) AS upcoming_events,
      (SELECT count(*)::int FROM events WHERE event_date >= $1::date AND event_date < $2::date AND status='CANCELLED' AND deleted_at IS NULL) AS cancelled_events,
      (SELECT count(*)::int FROM tasks WHERE due_date >= $1::date AND due_date < $2::date AND status <> 'DONE' AND deleted_at IS NULL) AS tasks_due,
      (SELECT count(*)::int FROM tasks WHERE due_date < current_date AND status <> 'DONE' AND deleted_at IS NULL) AS overdue_tasks,
      (SELECT count(*)::int FROM events e WHERE e.event_date >= current_date AND e.event_date < current_date + interval '30 days' AND e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM staff_assignments sa WHERE sa.event_id=e.id AND sa.released_at IS NULL)) AS events_missing_staff,
      (SELECT count(*)::int FROM events e WHERE e.event_date >= current_date AND e.event_date < current_date + interval '30 days' AND e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM equipment_assignments ea WHERE ea.event_id=e.id AND ea.released_at IS NULL)) AS events_missing_equipment,
      (SELECT count(*)::int FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL AND severity='CRITICAL' AND category IN ('EVENTS','STAFF','EQUIPMENT','INCIDENTS')) AS unread_critical_operational_alerts,
      (SELECT count(*)::int FROM staff_assignments sa JOIN events e ON e.id=sa.event_id WHERE sa.acknowledgement_status='DECLINED' AND sa.released_at IS NULL AND e.deleted_at IS NULL AND e.event_date >= current_date - interval '1 day') AS staff_declines,
      (SELECT count(*)::int FROM event_incidents WHERE deleted_at IS NULL AND status IN ('OPEN','IN_REVIEW') AND severity='CRITICAL') AS critical_incidents,
      (SELECT count(*)::int FROM equipment_assignments ea JOIN events e ON e.id=ea.event_id WHERE ea.released_at IS NULL AND ea.lifecycle_status IN ('CHECKED_OUT','IN_TRANSIT','ISSUE','MAINTENANCE') AND e.event_date < current_date) AS equipment_return_issues,
      (SELECT count(*)::int FROM staff_assignments sa JOIN events e ON e.id=sa.event_id WHERE e.event_date >= $1::date AND e.event_date < $2::date AND sa.released_at IS NULL) AS staff_assignments,
      (SELECT count(*)::int FROM equipment_assignments ea JOIN events e ON e.id=ea.event_id WHERE e.event_date >= $1::date AND e.event_date < $2::date AND ea.released_at IS NULL) AS equipment_utilization`,
    [start, end]
  );
  const row = normalizeNumbers(result.rows[0]);
  row.average_booking_value = row.bookings_won > 0 ? row.booked_revenue / row.bookings_won : 0;
  row.conversion_rate = row.new_leads > 0 ? (row.bookings_won / row.new_leads) * 100 : 0;
  row.projected_upcoming_balance = row.due_this_week;
  return row;
}

async function dashboardLists([start, end], range, user) {
  const todayOnly = range === "today";
  const todayEvents = await eventRows(todayOnly ? "e.event_date >= $1::date AND e.event_date < $2::date" : "e.event_date >= $1::date AND e.event_date < $2::date", [start, end], 12);
  const upcomingEvents = await eventRows("e.event_date >= current_date AND e.event_date < current_date + interval '30 days'", [], 10);
  const [tasks, attention, activity, weekly] = await Promise.all([
    query(`SELECT t.*, u.name AS owner_name, c.name AS client_name, e.event_name
      FROM tasks t LEFT JOIN users u ON u.id=t.assigned_user_id LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN events e ON e.id=t.event_id
      WHERE t.deleted_at IS NULL AND t.status <> 'DONE' AND t.due_date >= $1::date AND t.due_date < $2::date
      ORDER BY t.due_date, CASE t.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END LIMIT 12`, [start, end]),
    attentionItems([start, end]),
    query("SELECT * FROM activities ORDER BY created_at DESC LIMIT 12"),
    range === "week" ? weeklySchedule([start, end]) : Promise.resolve([])
  ]);
  return {
    todaysEvents: todayEvents.map((event) => redactForRole(event, user)),
    upcomingEvents,
    tasksDue: tasks.rows,
    needsAttention: attention,
    recentActivity: activity.rows,
    weeklySchedule: weekly,
    readiness: upcomingEvents.filter((event) => event.readiness_issues?.length)
  };
}

async function eventRows(whereSql, params, limit) {
  const result = await query(
    `SELECT e.id, e.event_name, e.event_date, e.start_time, e.end_time, e.setup_time, e.breakdown_time, e.venue_name, e.status, e.operational_status, e.event_type,
      c.name AS client_name, c.email AS client_email, c.phone AS client_phone, x.name AS experience_name, p.name AS package_name,
      b.payment_status, b.balance_due, b.total,
      COALESCE(sa.staff_count,0)::int AS staff_count,
      COALESCE(ea.equipment_count,0)::int AS equipment_count
     FROM events e
     LEFT JOIN clients c ON c.id=e.client_id
     LEFT JOIN experiences x ON x.id=e.experience_id
     LEFT JOIN packages p ON p.id=e.package_id
     LEFT JOIN bookings b ON b.event_id=e.id AND b.deleted_at IS NULL
     LEFT JOIN (SELECT event_id, count(*) AS staff_count FROM staff_assignments WHERE released_at IS NULL GROUP BY event_id) sa ON sa.event_id=e.id
     LEFT JOIN (SELECT event_id, count(*) AS equipment_count FROM equipment_assignments WHERE released_at IS NULL GROUP BY event_id) ea ON ea.event_id=e.id
     WHERE e.deleted_at IS NULL AND ${whereSql}
     ORDER BY e.event_date, COALESCE(e.start_time, '00:00'::time) LIMIT ${Number(limit)}`,
    params
  );
  const readiness = await readinessForEvents(result.rows);
  return result.rows.map((event) => ({ ...event, readiness_issues: readiness[event.id] || [] }));
}

async function attentionItems([start, end]) {
  const [missingStaff, missingEquipment, overdueInvoices, failedPayments, leadFollowUp, proposals, operationalEvents, criticalIncidents] = await Promise.all([
    eventRows("e.event_date >= current_date AND e.event_date < current_date + interval '14 days' AND NOT EXISTS (SELECT 1 FROM staff_assignments sa WHERE sa.event_id=e.id AND sa.released_at IS NULL)", [], 6),
    eventRows("e.event_date >= current_date AND e.event_date < current_date + interval '14 days' AND NOT EXISTS (SELECT 1 FROM equipment_assignments ea WHERE ea.event_id=e.id AND ea.released_at IS NULL)", [], 6),
    query("SELECT id, invoice_number, client_id, due_date, COALESCE(amount_outstanding,balance_due) AS amount_due, status FROM invoices WHERE deleted_at IS NULL AND status <> 'VOID' AND due_date < current_date AND COALESCE(amount_outstanding,balance_due) > 0 ORDER BY due_date LIMIT 6"),
    query("SELECT id, provider, amount, status, created_at FROM payments WHERE deleted_at IS NULL AND status='FAILED' ORDER BY created_at DESC LIMIT 6"),
    query("SELECT id, first_name, last_name, event_date, status, follow_up_date FROM leads WHERE deleted_at IS NULL AND (status='NEW' OR follow_up_date <= current_date OR status='QUALIFIED') ORDER BY follow_up_date NULLS FIRST, created_at LIMIT 8"),
    query("SELECT id, proposal_number, client_id, status, sent_at, valid_through FROM proposals WHERE deleted_at IS NULL AND status IN ('SENT','VIEWED') OR (deleted_at IS NULL AND valid_through <= current_date + interval '3 days' AND status NOT IN ('ACCEPTED','DECLINED','ARCHIVED')) ORDER BY valid_through NULLS LAST LIMIT 8"),
    query("SELECT id, event_name, event_date, operational_status FROM events WHERE deleted_at IS NULL AND event_date=current_date AND operational_status IN ('PREPARING','EN_ROUTE','ON_SITE','SETTING_UP','BREAKDOWN','ISSUE_REPORTED') ORDER BY start_time LIMIT 8"),
    query("SELECT id, event_id, severity, type, description FROM event_incidents WHERE deleted_at IS NULL AND status IN ('OPEN','IN_REVIEW') AND severity IN ('HIGH','CRITICAL') ORDER BY occurred_at DESC LIMIT 8")
  ]);
  return [
    ...missingStaff.map((event) => attention("EVENT_MISSING_STAFF", `${event.event_name} needs staff assigned.`, `/events/events/${event.id}`, event.event_date)),
    ...missingEquipment.map((event) => attention("EVENT_MISSING_EQUIPMENT", `${event.event_name} needs equipment assigned.`, `/events/events/${event.id}`, event.event_date)),
    ...overdueInvoices.rows.map((invoice) => attention("BALANCE_OVERDUE", `${invoice.invoice_number} has an overdue balance.`, `/finance/invoices/${invoice.id}`, invoice.due_date)),
    ...failedPayments.rows.map((payment) => attention("PAYMENT_FAILED", `${payment.provider} payment failed.`, `/finance/payments/${payment.id}`, payment.created_at)),
    ...leadFollowUp.rows.map((lead) => attention("LEAD_FOLLOW_UP", `${lead.first_name} ${lead.last_name} needs follow-up.`, `/sales/leads/${lead.id}`, lead.follow_up_date || lead.event_date)),
    ...proposals.rows.map((proposal) => attention("PROPOSAL_ATTENTION", `${proposal.proposal_number} needs proposal follow-up.`, `/sales/proposals/${proposal.id}`, proposal.valid_through || proposal.sent_at)),
    ...operationalEvents.rows.map((event) => attention("EVENT_DAY_STATUS", `${event.event_name} is ${event.operational_status.replaceAll("_", " ")}.`, `/events/events/${event.id}`, event.event_date)),
    ...criticalIncidents.rows.map((incident) => attention("CRITICAL_INCIDENT", `${incident.severity} ${incident.type} incident needs review.`, `/events/events/${incident.event_id}`, new Date().toISOString()))
  ].slice(0, 18);
}

function attention(type, message, href, date) {
  return { type, message, href, date };
}

async function revenueTrend([start, end], range) {
  const bucket = range === "ytd" ? "month" : range === "today" ? "hour" : "day";
  const format = bucket === "month" ? "YYYY-MM" : bucket === "hour" ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD";
  const result = await query(
    `SELECT bucket, sum(booked_revenue)::numeric AS booked_revenue, sum(collected_revenue)::numeric AS collected_revenue
     FROM (
       SELECT to_char(date_trunc('${bucket}', created_at), '${format}') AS bucket, total AS booked_revenue, 0::numeric AS collected_revenue
       FROM bookings WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL
       UNION ALL
       SELECT to_char(date_trunc('${bucket}', COALESCE(paid_at, payment_date::timestamptz, created_at)), '${format}') AS bucket, 0::numeric AS booked_revenue, amount - refunded_amount AS collected_revenue
       FROM payments WHERE COALESCE(paid_at, payment_date::timestamptz, created_at) >= $1 AND COALESCE(paid_at, payment_date::timestamptz, created_at) < $2 AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') AND deleted_at IS NULL
     ) trend GROUP BY bucket ORDER BY bucket`,
    [start, end]
  );
  return result.rows.map(normalizeNumbers);
}

async function salesFunnel([start, end]) {
  const result = await query(
    `SELECT
      (SELECT count(*)::int FROM leads WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL) AS leads,
      (SELECT count(*)::int FROM leads WHERE updated_at >= $1 AND updated_at < $2 AND status IN ('QUALIFIED','PROPOSAL_DRAFT','PROPOSAL_SENT','WON') AND deleted_at IS NULL) AS qualified,
      (SELECT count(DISTINCT COALESCE(lead_id,id))::int FROM proposals WHERE sent_at >= $1 AND sent_at < $2 AND deleted_at IS NULL) AS proposals_sent,
      (SELECT count(DISTINCT COALESCE(lead_id,id))::int FROM proposals WHERE accepted_at >= $1 AND accepted_at < $2 AND deleted_at IS NULL) AS proposals_accepted,
      (SELECT count(*)::int FROM leads WHERE updated_at >= $1 AND updated_at < $2 AND status='WON' AND deleted_at IS NULL) AS booked`,
    [start, end]
  );
  const row = normalizeNumbers(result.rows[0]);
  const stages = [
    { key: "leads", label: "Leads", count: row.leads },
    { key: "qualified", label: "Qualified", count: row.qualified },
    { key: "proposals_sent", label: "Proposals Sent", count: row.proposals_sent },
    { key: "proposals_accepted", label: "Proposals Accepted", count: row.proposals_accepted },
    { key: "booked", label: "Booked", count: row.booked }
  ];
  return {
    attribution: "Lead stages are counted once per lead where possible; proposal stages use distinct lead IDs when available and proposal IDs otherwise. Booked uses leads marked WON in the selected period.",
    stages: stages.map((stage, index) => ({
      ...stage,
      previous_conversion: index === 0 ? null : percent(stage.count, stages[index - 1].count),
      overall_conversion: percent(stage.count, stages[0].count)
    }))
  };
}

async function leadSourcePerformance([start, end]) {
  const result = await query(
    `SELECT COALESCE(referral_source, lead_source, 'Other') AS source,
      count(*)::int AS leads,
      count(*) FILTER (WHERE l.status IN ('QUALIFIED','PROPOSAL_DRAFT','PROPOSAL_SENT','WON'))::int AS qualified,
      COALESCE(sum(p.proposals),0)::int AS proposals,
      count(*) FILTER (WHERE l.status='WON')::int AS bookings,
      COALESCE(sum(b.total),0)::numeric AS booked_revenue
     FROM leads l
     LEFT JOIN LATERAL (SELECT count(*) AS proposals FROM proposals WHERE lead_id=l.id AND deleted_at IS NULL) p ON true
     LEFT JOIN LATERAL (SELECT sum(total) AS total FROM bookings WHERE lead_id=l.id AND deleted_at IS NULL) b ON true
     WHERE l.created_at >= $1 AND l.created_at < $2 AND l.deleted_at IS NULL
     GROUP BY 1 ORDER BY leads DESC`,
    [start, end]
  );
  return result.rows.map((row) => ({ ...normalizeNumbers(row), conversion_rate: percent(Number(row.bookings), Number(row.leads)) }));
}

async function topPerformers([start, end]) {
  const [packages, experiences, eventTypes, leadSources] = await Promise.all([
    query("SELECT p.name, count(*)::int AS bookings, COALESCE(sum(b.total),0)::numeric AS revenue FROM events e JOIN packages p ON p.id=e.package_id LEFT JOIN bookings b ON b.event_id=e.id WHERE e.event_date >= $1::date AND e.event_date < $2::date AND e.deleted_at IS NULL GROUP BY p.name ORDER BY revenue DESC, bookings DESC LIMIT 5", [start, end]),
    query("SELECT x.name, count(*)::int AS bookings, COALESCE(sum(b.total),0)::numeric AS revenue FROM events e JOIN experiences x ON x.id=e.experience_id LEFT JOIN bookings b ON b.event_id=e.id WHERE e.event_date >= $1::date AND e.event_date < $2::date AND e.deleted_at IS NULL GROUP BY x.name ORDER BY revenue DESC, bookings DESC LIMIT 5", [start, end]),
    query("SELECT e.event_type AS name, count(*)::int AS bookings, COALESCE(sum(b.total),0)::numeric AS revenue FROM events e LEFT JOIN bookings b ON b.event_id=e.id WHERE e.event_date >= $1::date AND e.event_date < $2::date AND e.deleted_at IS NULL GROUP BY e.event_type ORDER BY revenue DESC, bookings DESC LIMIT 5", [start, end]),
    query("SELECT COALESCE(l.referral_source,l.lead_source,'Other') AS name, count(*)::int AS leads, count(*) FILTER (WHERE l.status='WON')::int AS bookings FROM leads l WHERE l.created_at >= $1 AND l.created_at < $2 AND l.deleted_at IS NULL GROUP BY 1 ORDER BY bookings DESC, leads DESC LIMIT 5", [start, end])
  ]);
  return {
    packages: packages.rows.map(normalizeNumbers),
    experiences: experiences.rows.map(normalizeNumbers),
    eventTypes: eventTypes.rows.map(normalizeNumbers),
    leadSources: leadSources.rows.map(normalizeNumbers)
  };
}

async function weeklySchedule([start, end]) {
  const events = await eventRows("e.event_date >= $1::date AND e.event_date < $2::date", [start, end], 80);
  return events.reduce((days, event) => {
    const key = dateKey(event.event_date);
    days[key] = [...(days[key] || []), event];
    return days;
  }, {});
}

export async function readinessForEvents(events) {
  const result = {};
  for (const event of events) {
    const issues = [];
    if (!event.client_name && !event.client_email) issues.push("Client details incomplete");
    if (!event.venue_name) issues.push("Venue missing");
    if (!event.parking_loading_instructions && !event.venue_address) issues.push("Setup instructions missing");
    if (!event.print_template) issues.push("Creative/template incomplete");
    if (Number(event.staff_count || 0) < 1) issues.push("Staff not assigned");
    if (Number(event.equipment_count || 0) < 1) issues.push("Equipment not assigned");
    if (Number(event.balance_due || 0) > 0 && event.event_date && new Date(event.event_date) <= new Date(Date.now() + 7 * 86400000)) issues.push("Balance due");
    if (event.payment_status === "UNPAID") issues.push("Deposit/payment pending");
    result[event.id] = issues;
  }
  return result;
}

function decorateCalendarEvent(event, readinessIssues) {
  return {
    ...event,
    phases: {
      setup: { start: event.setup_time || event.start_time, end: event.start_time },
      live: { start: event.start_time, end: event.end_time },
      breakdown: { start: event.end_time, end: event.breakdown_time || event.end_time }
    },
    readiness_status: readinessIssues.length ? `${readinessIssues.length} ITEMS NEED ATTENTION` : "READY",
    readiness_issues: readinessIssues,
    href: `/events/events/${event.id}`
  };
}

function groupMetrics(current, previous) {
  return [
    group("Sales", [
      metric("new_leads", "New Leads", current, previous, "/sales/leads"),
      metric("new_social_leads", "New Social Leads", current, previous, "/sales/leads?source=META"),
      metric("leads_awaiting_response", "Awaiting Response", current, previous, "/sales/leads?status=NEW"),
      metric("average_first_response_time", "Avg First Response", current, previous, "/sales/leads", "minutes"),
      metric("qualified_leads", "Qualified Leads", current, previous, "/sales/leads?status=QUALIFIED"),
      metric("proposals_sent", "Proposals Sent", current, previous, "/sales/proposals?status=SENT"),
      metric("proposals_accepted", "Proposals Accepted", current, previous, "/sales/proposals?status=ACCEPTED"),
      metric("bookings_won", "Bookings Won", current, previous, "/events/events?status=CONFIRMED"),
      metric("conversion_rate", "Conversion Rate", current, previous, "/sales/leads", "percent"),
      metric("average_booking_value", "Average Booking Value", current, previous, "/finance/invoices", "money")
    ]),
    group("Revenue", [
      metric("booked_revenue", "Booked Revenue", current, previous, "/events/events", "money"),
      metric("collected_revenue", "Collected Revenue", current, previous, "/finance/payments", "money"),
      metric("outstanding_balance", "Outstanding Balance", current, previous, "/finance/invoices?balance=open", "money"),
      metric("deposits_collected", "Deposits Collected", current, previous, "/finance/payments", "money"),
      metric("refunds", "Refunds", current, previous, "/finance/payments?status=REFUNDED", "money"),
      metric("projected_upcoming_balance", "Projected Upcoming Balance", current, previous, "/finance/invoices?due=week", "money")
    ]),
    group("Events", [
      metric("events_scheduled", "Events Scheduled", current, previous, "/events/events"),
      metric("events_completed", "Events Completed", current, previous, "/events/events?status=COMPLETED"),
      metric("upcoming_events", "Upcoming Events", current, previous, "/events/events"),
      metric("cancelled_events", "Cancelled Events", current, previous, "/events/events?status=CANCELLED")
    ]),
    group("Operations", [
      metric("tasks_due", "Tasks Due", current, previous, "/operations/tasks"),
      metric("overdue_tasks", "Overdue Tasks", current, previous, "/operations/tasks?overdue=true"),
      metric("events_missing_staff", "Events Missing Staff", current, previous, "/events/events?readiness=staff"),
      metric("events_missing_equipment", "Events Missing Equipment", current, previous, "/events/events?readiness=equipment"),
      metric("unread_critical_operational_alerts", "Critical Alerts", current, previous, "/"),
      metric("staff_declines", "Staff Declines", current, previous, "/events/events"),
      metric("critical_incidents", "Critical Incidents", current, previous, "/events/events"),
      metric("equipment_return_issues", "Return Issues", current, previous, "/events/equipment"),
      metric("failed_integration_events", "Failed Integration Events", current, previous, "/system/integrations"),
      metric("staff_assignments", "Staff Assignments", current, previous, "/events/staff"),
      metric("equipment_utilization", "Equipment Utilization", current, previous, "/events/equipment")
    ])
  ];
}

function group(title, metrics) {
  return { title, metrics };
}

function metric(key, label, current, previous, href, format = "number") {
  return {
    key,
    label,
    value: Number(current[key] || 0),
    previous: Number(previous[key] || 0),
    comparison: compare(Number(current[key] || 0), Number(previous[key] || 0)),
    href,
    format
  };
}

function compare(current, previous) {
  if (!previous) return { label: "No comparison available", direction: "none", percent: null };
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return {
    label: `${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)}%`,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
    percent: change
  };
}

function percent(value, total) {
  return total > 0 ? Math.round((Number(value || 0) / Number(total)) * 1000) / 10 : 0;
}

function normalizeNumbers(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value]));
}

function calendarRanges(anchor, timeZone, weekStart) {
  const business = getBusinessDateRanges({ now: anchor, timeZone, weekStart });
  const date = anchor.toISOString().slice(0, 10);
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  return {
    day: { startDate: toSqlRange(business.today).start.slice(0, 10), endDate: toSqlRange(business.today).end.slice(0, 10) },
    week: { startDate: toSqlRange(business.week).start.slice(0, 10), endDate: toSqlRange(business.week).end.slice(0, 10) },
    month: { startDate: monthStart, endDate: monthEnd }
  };
}

function addFilter(where, params, column, value) {
  if (!value) return;
  params.push(value);
  where.push(`${column}=$${params.length}`);
}

function dateKey(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function calendarLegend() {
  return [
    { status: "TENTATIVE", label: "Tentative", tone: "neutral" },
    { status: "CONFIRMED", label: "Confirmed", tone: "gold" },
    { status: "PREPARING", label: "Preparing", tone: "amber" },
    { status: "READY", label: "Ready", tone: "charcoal" },
    { status: "IN_PROGRESS", label: "In Progress", tone: "active" },
    { status: "COMPLETED", label: "Completed", tone: "green" },
    { status: "CANCELLED", label: "Cancelled", tone: "red" }
  ];
}

function redactForRole(event, user) {
  if (!user?.roles?.includes("ATTENDANT")) return event;
  const { balance_due, total, ...safe } = event;
  return safe;
}

function metricDefinitions() {
  return {
    booked_revenue: "Booked revenue is the sum of booking totals created in the selected period. It does not count draft proposals as revenue.",
    collected_revenue: "Collected revenue is successful net payments minus refunded amounts in the selected period.",
    conversion_rate: "Conversion rate is bookings won divided by new leads in the selected period.",
    average_booking_value: "Average booking value is booked revenue divided by bookings won.",
    outstanding_balance: "Outstanding balance is the current unpaid amount on non-void invoices, independent of selected period."
  };
}
