import {query,transaction} from '../db/pool.js';

export async function claimPostcardDispatch(albumId,postcardId,personId,{allowExtra=false,jobId=null}={}) {
  return transaction(async()=>{
    // Two distinct draft rows do not lock one another. Serialize the recipient
    // across API/worker processes before checking any prior dispatch outcome.
    await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
    if(jobId){
      const permitted=await query(`SELECT 1 FROM gallery_mailing_jobs j JOIN gallery_mailing_policies policy ON policy.album_id=j.album_id JOIN gallery_albums a ON a.id=j.album_id JOIN events event ON event.id=a.event_id JOIN gallery_postcards p ON p.id=j.postcard_id
        LEFT JOIN LATERAL(SELECT v.id,p2.id AS proposal_id FROM proposals p2 JOIN proposal_versions v ON v.id=p2.accepted_version_id AND v.proposal_id=p2.id WHERE p2.event_id=a.event_id AND p2.deleted_at IS NULL AND p2.status IN('ACCEPTED','CONVERTED') ORDER BY p2.created_at DESC LIMIT 1) accepted ON true
        WHERE event.deleted_at IS NULL AND event.sales_closed_at IS NULL AND event.status<>'CANCELLED' AND a.status NOT IN('ARCHIVED','EXPIRED') AND j.id=$1 AND j.album_id=$2 AND j.postcard_id=$3 AND j.status='PROCESSING' AND j.revision=p.revision AND j.proof_hash=p.proof_hash
        AND policy.proposal_id IS NOT DISTINCT FROM accepted.proposal_id AND policy.version_id IS NOT DISTINCT FROM accepted.id
        AND policy.quantity_limit>=(SELECT count(*) FROM gallery_mailing_jobs used WHERE used.album_id=j.album_id AND used.status<>'CANCELLED')
        AND policy.cost_limit_cents>=(SELECT COALESCE(sum(cost_cents),0) FROM gallery_mailing_jobs used WHERE used.album_id=j.album_id AND used.status<>'CANCELLED')
        AND NOT EXISTS(SELECT 1 FROM gallery_mailing_requests r WHERE r.album_id=j.album_id AND (r.status<>'APPROVED' OR r.return_address_hash IS DISTINCT FROM j.sender_hash OR r.quantity<(SELECT count(*) FROM gallery_mailing_jobs used WHERE used.album_id=j.album_id AND used.status<>'CANCELLED')))`,[jobId,albumId,postcardId]);
      if(!permitted.rowCount)return {rowCount:0,rows:[]};
    }
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gallery-postcard:${albumId}:${personId}`]);
    return query(`UPDATE gallery_postcards SET status='SUBMITTING',updated_at=now()
      WHERE album_id=$1 AND id=$2 AND person_id=$3 AND status='APPROVED' AND lob_postcard_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM (
        SELECT DISTINCT ON(fingerprint) person_id,status FROM gallery_fiesta_survey_rows
        WHERE album_id=$1 ORDER BY fingerprint,sequence DESC
      ) survey WHERE survey.person_id=$3 AND survey.status IN('NEEDS_REVIEW','NO_CONSENT','PREPARED_LOCKED'))
      AND NOT EXISTS(SELECT 1 FROM gallery_postcards other WHERE other.album_id=$1
        AND other.person_id=$3 AND other.id<>$2 AND (other.status IN('SUBMITTING','FAILED') OR (other.status='SUBMITTED_TEST' AND NOT $4)))
      RETURNING id`,[albumId,postcardId,personId,allowExtra]);
  });
}
