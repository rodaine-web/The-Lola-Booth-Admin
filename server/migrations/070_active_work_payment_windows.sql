-- Derived work views and reminder cadence. No customer, agreement or payment backfill.
CREATE FUNCTION business_today() RETURNS date LANGUAGE sql STABLE AS $$
 SELECT (now() AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))::date
$$;
CREATE FUNCTION event_work_active(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM events e WHERE e.id=target AND e.deleted_at IS NULL AND e.sales_closed_at IS NULL AND e.status<>'CANCELLED'
 AND (NOT (e.status='COMPLETED' OR COALESCE(e.operational_status='COMPLETED',false))
 OR EXISTS(SELECT 1 FROM event_closeouts x WHERE x.event_id=e.id AND x.closed_at IS NULL)
 OR EXISTS(SELECT 1 FROM invoices i WHERE i.event_id=e.id AND i.deleted_at IS NULL AND i.status NOT IN ('VOID','REFUNDED','DRAFT') AND i.amount_outstanding>0)))
$$;
CREATE FUNCTION client_work_active(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM events e WHERE e.client_id=target AND event_work_active(e.id))
 OR EXISTS(SELECT 1 FROM invoices i WHERE i.client_id=target AND i.deleted_at IS NULL AND i.status NOT IN ('VOID','REFUNDED','DRAFT') AND i.amount_outstanding>0)
$$;
CREATE FUNCTION task_event_preparation(t tasks) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT t.event_id IS NOT NULL AND NOT (COALESCE(t.lifecycle_key,'') ~ '^(agreement|proposal|booking-balance|booking-invoice|checkout-review|booking-confirmation)'
 OR t.title ~* '(proposal|invoice|agreement|signature|payment|receipt|refund|dispute|thank.you|closeout|gallery|delivery|booking step)')
$$;
CREATE FUNCTION task_work_actionable(t tasks) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT t.deleted_at IS NULL AND t.status IN ('OPEN','IN_PROGRESS') AND CASE WHEN task_event_preparation(t) THEN
 EXISTS(SELECT 1 FROM events e WHERE e.id=t.event_id AND e.deleted_at IS NULL AND e.sales_closed_at IS NULL AND e.status NOT IN ('COMPLETED','CANCELLED') AND COALESCE(e.operational_status,'')<>'COMPLETED' AND e.event_date<=business_today()+30)
 ELSE (t.status='IN_PROGRESS' OR t.due_date IS NULL OR t.due_date<=business_today()) END
$$;
CREATE FUNCTION task_reminder_period(t tasks) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN task_event_preparation(t) THEN
 (SELECT CASE WHEN e.event_date>business_today()+30 THEN 'event-month:'||to_char(business_today(),'YYYY-MM')||':'||e.id
 WHEN e.event_date>business_today()+7 THEN 'event-week:'||to_char(business_today(),'IYYY-IW')||':'||e.id
 WHEN (t.due_date<=business_today() AND (t.priority IN ('HIGH','URGENT') OR t.due_date<business_today())) OR (t.due_date IS NULL AND t.priority IN ('HIGH','URGENT')) THEN business_today()::text END
 FROM events e WHERE e.id=t.event_id AND e.deleted_at IS NULL AND e.sales_closed_at IS NULL AND e.status NOT IN ('COMPLETED','CANCELLED') AND COALESCE(e.operational_status,'')<>'COMPLETED')
 WHEN task_work_actionable(t) THEN business_today()::text END
$$;
-- Shared canonical due date; explicit approved arrangements remain auditable exceptions.
CREATE FUNCTION invoice_balance_deadline(target uuid) RETURNS date LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN x.id IS NOT NULL THEN x.balance_due_date WHEN e.event_date IS NOT NULL THEN LEAST(COALESCE(i.due_date,e.event_date-14),GREATEST(e.event_date-14,(i.created_at AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))::date)) ELSE i.due_date END
 FROM invoices i LEFT JOIN events e ON e.id=i.event_id
 LEFT JOIN booking_payment_exceptions x ON x.event_id=e.id AND x.revoked_at IS NULL WHERE i.id=target
$$;
