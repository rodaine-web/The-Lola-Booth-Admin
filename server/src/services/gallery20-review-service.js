import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { userCanAccessEvent } from './event-operations-service.js';

async function albumForEvent(eventId, user) {
  const event = (await query('SELECT id FROM events WHERE id=$1 AND deleted_at IS NULL', [eventId])).rows[0];
  if (!event) throw new AppError('Event not found.', 404, 'NOT_FOUND');
  if (!(await userCanAccessEvent(user, eventId))) throw new AppError('Event access denied.', 403, 'FORBIDDEN');
  return (await query(`SELECT id, event_id, title, status, source_provider, external_event_id,
    published_at, expires_at, retention_days FROM gallery_albums WHERE event_id=$1`, [eventId])).rows[0] || null;
}

export async function gallery20EventOverview(eventId, user) {
  const album = await albumForEvent(eventId, user);
  if (!album) return {album: null, stats: null, postcard: {status: 'NOT_CONFIGURED', reason: 'Create an event gallery first.'}};
  const review = await gallery20AlbumReview(album.id, user);
  return {album, stats: review.stats, postcard: review.postcard};
}

export async function gallery20AlbumReview(albumId, user) {
  const owned = (await query('SELECT event_id FROM gallery_albums WHERE id=$1', [albumId])).rows[0];
  if (!owned) throw new AppError('Gallery not found.', 404, 'NOT_FOUND');
  const album = await albumForEvent(owned.event_id, user);
  const [rows, totals] = await Promise.all([
    query(`WITH candidates AS (
      SELECT filename, count(*)::int AS candidate_count,
             array_agg(id ORDER BY created_at) AS candidate_ids
      FROM gallery_media WHERE album_id=$1 AND status<>'ARCHIVED' GROUP BY filename
    ), assignments AS (
      SELECT s.person_id, s.filename, count(DISTINCT mp.media_id)::int AS confirmed_count,
             array_agg(DISTINCT mp.media_id) FILTER (WHERE mp.media_id IS NOT NULL) AS confirmed_ids
      FROM fiesta_gallery_shares s
      LEFT JOIN gallery_media m ON m.album_id=s.album_id AND m.filename=s.filename AND m.status<>'ARCHIVED'
      LEFT JOIN gallery_media_people mp ON mp.media_id=m.id AND mp.person_id=s.person_id
      WHERE s.album_id=$1 GROUP BY s.person_id,s.filename
    )
    SELECT s.person_id,p.display_name,s.filename,
      COALESCE(c.candidate_count,0) AS candidate_count,
      COALESCE(c.candidate_ids,'{}'::uuid[]) AS candidate_ids,
      COALESCE(a.confirmed_count,0) AS confirmed_count,
      COALESCE(a.confirmed_ids,'{}'::uuid[]) AS confirmed_ids
    FROM fiesta_gallery_shares s
    JOIN gallery_people p ON p.id=s.person_id AND p.album_id=s.album_id
    LEFT JOIN candidates c ON c.filename=s.filename
    LEFT JOIN assignments a ON a.person_id=s.person_id AND a.filename=s.filename
    WHERE s.album_id=$1 ORDER BY s.filename,p.display_name LIMIT 5001`, [albumId]),
    query(`SELECT
      (SELECT count(*)::int FROM gallery_media WHERE album_id=$1 AND status<>'ARCHIVED') AS photos,
      (SELECT count(*)::int FROM gallery_people WHERE album_id=$1 AND status='ACTIVE') AS people,
      (SELECT count(*)::int FROM gallery_media m WHERE album_id=$1 AND status<>'ARCHIVED'
         AND NOT EXISTS (SELECT 1 FROM gallery_media_people mp WHERE mp.media_id=m.id)) AS unassigned_photos`, [albumId])
  ]);
  if (rows.rows.length > 5000) throw new AppError('Review limit reached. Split large imports before continuing.', 422, 'GALLERY_REVIEW_LIMIT');
  const records = rows.rows.map(r => ({
    personId: r.person_id, guest: r.display_name, filename: r.filename,
    candidateCount: r.candidate_count, candidateIds: r.candidate_ids,
    confirmedIds: r.confirmed_ids,
    status: r.confirmed_count === 1 ? 'MATCHED' : r.confirmed_count > 1 ? 'CONFLICT'
      : r.candidate_count === 0 ? 'PHOTO_MISSING'
      : r.candidate_count === 1 ? 'REVIEW_REQUIRED' : 'AMBIGUOUS'
  }));
  const stats = {
    ...totals.rows[0], sharingRecords: records.length,
    matched: records.filter(r => r.status === 'MATCHED').length,
    pending: records.filter(r => r.status === 'PHOTO_MISSING' || r.status === 'REVIEW_REQUIRED').length,
    ambiguous: records.filter(r => ['AMBIGUOUS','CONFLICT'].includes(r.status)).length
  };
  // Fiesta's supported CSV contains sharing destinations, not postal addresses or mailing consent.
  // No postcard orders, mailing-eligible recipients, or address data can be inferred here.
  const postcard = {status: 'BLOCKED', eligible: 0,
    reason: 'Postal addresses, explicit physical-mail consent, artwork approval and Lob order integration have not been verified.'};
  return {album, stats, records, postcard};
}
