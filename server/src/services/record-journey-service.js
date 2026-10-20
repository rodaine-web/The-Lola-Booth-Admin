import {query} from '../db/pool.js';
/** Read-time projection of existing records; no second persisted lifecycle status. */
export async function recordJourney(event,clientId=null){
 const proposal=(await query(`SELECT p.* FROM proposals p WHERE p.deleted_at IS NULL AND
  (($1::uuid IS NULL AND p.client_id=$2::uuid AND p.event_id IS NULL) OR p.event_id=$1 OR EXISTS(SELECT 1 FROM invoices i WHERE i.proposal_id=p.id AND i.event_id=$1 AND i.deleted_at IS NULL)
   OR EXISTS(SELECT 1 FROM leads l WHERE l.id=p.lead_id AND l.converted_event_id=$1))
  ORDER BY (p.status IN ('ACCEPTED','CONVERTED')) DESC,p.accepted_at DESC NULLS LAST,p.created_at DESC,p.id LIMIT 1`,[event.id,clientId])).rows[0]||null;
 const invoice=proposal?(await query(`SELECT i.*,COALESCE((SELECT sum(payment_net_received(pay)) FROM payments pay
  WHERE pay.invoice_id=i.id AND pay.deleted_at IS NULL AND pay.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')),0)::numeric AS verified_paid
  FROM invoices i WHERE i.proposal_id=$1 AND i.deleted_at IS NULL 
   AND ($2::uuid IS NULL OR i.pricing_snapshot->>'accepted_version_id'=$2::text)
  ORDER BY (i.status NOT IN ('VOID','REFUNDED')) DESC,i.created_at DESC,i.id LIMIT 1`,[proposal.id,proposal.accepted_version_id])).rows[0]||null:null;
 const contracts=proposal?(await query(`SELECT id,revision,status,signed_at,issued_at,jsonb_build_object('accepted_version_id',snapshot->>'accepted_version_id') AS snapshot
  FROM contracts WHERE proposal_id=$1 ORDER BY revision DESC`,[proposal.id])).rows:[];
 const workspace=proposal?(await query('SELECT 1 FROM client_workspace_grants WHERE proposal_id=$1 AND revoked_at IS NULL',[proposal.id])).rowCount>0:false;
 return {...event,lifecycle:{proposal,invoice,contracts,workspace}};
}
