-- Cover historical manual-wizard prospects without reclassifying older returning clients.
UPDATE clients c SET sales_qualified=false,updated_at=now() WHERE
 EXISTS(SELECT 1 FROM proposals p JOIN leads l ON l.id=p.lead_id WHERE p.client_id=c.id AND l.deleted_at IS NULL AND c.created_at>=l.created_at)
 AND NOT EXISTS(SELECT 1 FROM leads l WHERE (l.converted_client_id=c.id OR EXISTS(SELECT 1 FROM proposals p WHERE p.lead_id=l.id AND p.client_id=c.id)) AND l.status='WON')
 AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.client_id=c.id AND i.amount_paid>0)
 AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.client_id=c.id AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'))
 AND NOT EXISTS(SELECT 1 FROM contracts k JOIN proposals p ON p.id=k.proposal_id WHERE p.client_id=c.id AND k.status='SIGNED');
UPDATE crm_contacts c SET contact_type='PROSPECT',updated_at=now() WHERE c.contact_type='CLIENT'
 AND EXISTS(SELECT 1 FROM clients cl WHERE cl.contact_id=c.id AND NOT cl.sales_qualified)
 AND NOT EXISTS(SELECT 1 FROM clients cl WHERE cl.contact_id=c.id AND cl.sales_qualified AND cl.deleted_at IS NULL);
CREATE OR REPLACE FUNCTION close_lost_sales_lead(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE event_target uuid;
BEGIN
 IF sales_lead_protected(target) THEN RAISE EXCEPTION 'Paid, signed or confirmed bookings require the cancellation workflow before marking the lead Lost.' USING ERRCODE='P0001';END IF;
 -- Lock linked proposals to serialize against acceptance and payment handoffs.
 PERFORM id FROM proposals WHERE lead_id=target ORDER BY id FOR UPDATE;
 IF sales_lead_protected(target) THEN RAISE EXCEPTION 'Paid, signed or confirmed bookings require the cancellation workflow before marking the lead Lost.' USING ERRCODE='P0001';END IF;
 UPDATE tasks SET status='CANCELLED',closure_reason='Lead marked Lost',closed_at=now(),updated_at=now()
 WHERE deleted_at IS NULL AND status IN ('OPEN','IN_PROGRESS') AND
 (lead_id=target OR proposal_id IN(SELECT id FROM proposals WHERE lead_id=target));
 UPDATE proposals SET status='DECLINED',updated_at=now() WHERE lead_id=target AND deleted_at IS NULL
 AND status IN ('DRAFT','READY','SENT','VIEWED','ACCEPTED','EXPIRED');
 UPDATE invoices SET status='VOID',updated_at=now() WHERE amount_paid=0 AND status NOT IN ('PAID','REFUNDED','VOID')
 AND (lead_id=target OR proposal_id IN(SELECT id FROM proposals WHERE lead_id=target));
 UPDATE automation_jobs SET status='CANCELLED',last_error='Lead marked Lost',updated_at=now()
 WHERE status='PENDING' AND ((related_entity_type='lead' AND related_entity_id=target)
 OR (related_entity_type='proposal' AND related_entity_id IN(SELECT id FROM proposals WHERE lead_id=target)));
 UPDATE communications SET status='CANCELLED',failure_message='Lead marked Lost',updated_at=now()
 WHERE status IN ('DRAFT','SCHEDULED','PENDING_APPROVAL') AND
 (lead_id=target OR proposal_id IN(SELECT id FROM proposals WHERE lead_id=target));
 FOR event_target IN SELECT DISTINCT event_id FROM proposals WHERE lead_id=target AND event_id IS NOT NULL
 UNION SELECT converted_event_id FROM leads WHERE id=target AND converted_event_id IS NOT NULL LOOP
  IF NOT EXISTS(SELECT 1 FROM proposals WHERE event_id=event_target AND lead_id IS DISTINCT FROM target AND deleted_at IS NULL AND status NOT IN ('DECLINED','EXPIRED','ARCHIVED'))
  AND NOT EXISTS(SELECT 1 FROM invoices WHERE event_id=event_target AND amount_paid>0) THEN
   UPDATE events SET status='CANCELLED',sales_closed_at=COALESCE(sales_closed_at,now()),updated_at=now()
   WHERE id=event_target AND sales_closed_at IS NULL AND status IN ('DRAFT','INQUIRY','TENTATIVE','PENDING_CONTRACT','PENDING_DEPOSIT','CANCELLED');
   IF FOUND THEN
    UPDATE tasks SET status='CANCELLED',closure_reason='Lead marked Lost',closed_at=now(),updated_at=now() WHERE event_id=event_target AND deleted_at IS NULL AND status IN ('OPEN','IN_PROGRESS');
    UPDATE bookings SET sales_closed_at=COALESCE(sales_closed_at,now()),updated_at=now() WHERE event_id=event_target AND sales_closed_at IS NULL;
    UPDATE booking_holds SET status='RELEASED',updated_at=now() WHERE event_id=event_target AND status='ACTIVE';
    UPDATE equipment_assignments SET released_at=now() WHERE event_id=event_target AND released_at IS NULL;
    UPDATE staff_assignments SET released_at=now() WHERE event_id=event_target AND released_at IS NULL;
   END IF;
  END IF;
 END LOOP;
END $$;


SELECT reconcile_sales_lifecycle();
