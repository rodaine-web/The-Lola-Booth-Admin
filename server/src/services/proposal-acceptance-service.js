import { transaction } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { recordActivity } from './activity-service.js';

export const invoiceHandoffEnabled = () => process.env.BOOKING_INVOICE_HANDOFF_ENABLED === 'true';
export const INVOICE_HANDOFF_JOB = 'BOOKING_SEND_ACCEPTED_INVOICE';

/** Acceptance and its durable handoff commit together. No external delivery in this transaction. */
export async function acceptProposal(proposalId, acceptedByName, req) {
  return transaction(async client => {
    const proposal = (await client.query(`SELECT * FROM proposals WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [proposalId])).rows[0];
    if (!proposal) throw new AppError('Proposal not found.', 404, 'NOT_FOUND');
    if (['ACCEPTED', 'CONVERTED'].includes(proposal.status)) {
      const queued = await client.query('SELECT 1 FROM automation_jobs WHERE job_type=$1 AND related_entity_id=$2 LIMIT 1', [INVOICE_HANDOFF_JOB, proposalId]);
      return { proposal, duplicate: true, invoiceQueued: queued.rowCount > 0 };
    }
    if (!['SENT', 'VIEWED'].includes(proposal.status)) throw new AppError('This proposal is not available for acceptance.', 409, 'PROPOSAL_NOT_ACCEPTABLE');
    const version = (await client.query('SELECT id FROM proposal_versions WHERE proposal_id=$1 ORDER BY version_number DESC LIMIT 1', [proposalId])).rows[0];
    if (!version) throw new AppError('This proposal needs a saved version before acceptance. Contact The LOLA Booth.', 409, 'PROPOSAL_VERSION_REQUIRED');
    const updated = (await client.query(`UPDATE proposals SET status='ACCEPTED',accepted_at=now(),accepted_by_name=$2,
      accepted_ip=$3,accepted_user_agent=$4,accepted_version_id=$5,updated_at=now()
      WHERE id=$1 AND (valid_through IS NULL OR valid_through>=current_date) RETURNING *`,
    [proposalId, acceptedByName, req.ip, req.headers?.['user-agent'] || null, version.id])).rows[0];
    if (!updated) throw new AppError('This proposal has expired. Contact The LOLA Booth for an updated proposal.', 409, 'PROPOSAL_EXPIRED');
    const invoiceQueued = invoiceHandoffEnabled();
    if (invoiceQueued) {
      await client.query(`INSERT INTO automation_jobs(job_type,related_entity_type,related_entity_id,payload,scheduled_for)
        VALUES($1,'proposal',$2,$3,now())`, [INVOICE_HANDOFF_JOB, proposalId, { acceptedVersionId: version.id }]);
    }
    await recordActivity({ entityType: 'proposal', entityId: proposalId, action: 'proposal_accepted', summary: `Proposal ${proposal.proposal_number} accepted by ${acceptedByName}` });
    return { proposal: updated, duplicate: false, invoiceQueued };
  });
}
