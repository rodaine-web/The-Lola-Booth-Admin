import crypto from 'node:crypto';
import sharp from 'sharp';
import {AppError} from '../utils/errors.js';

const unavailable = () => new AppError('This proof is unavailable. Refresh the cart and review its current photos.', 404, 'KEEPSAKES_PROOF_UNAVAILABLE');
const validIndex = value => Number.isSafeInteger(value) && value >= 0;
const validQuoteId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// The browser receives a reduced derivative of the actual print renderer's
// output, preserving its complete aspect ratio, borders and message layout.
// No original metadata, supplier URL or private storage locator is returned.
export async function renderKeepsakesProofThumbnail(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 20 * 1024 * 1024) throw unavailable();
  try {
    return await sharp(buffer, {limitInputPixels: 60_000_000}).rotate()
      .resize({width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true})
      .flatten({background: '#ffffff'}).toColourspace('srgb').jpeg({quality: 88, chromaSubsampling: '4:4:4'}).toBuffer();
  } catch { throw unavailable(); }
}

export function keepsakesProofDescriptors(type, token, quoteId, items) {
  if (!['photo', 'p', 'a'].includes(type) || typeof token !== 'string' || !token || !validQuoteId(quoteId) || !Array.isArray(items)) throw unavailable();
  const root = `/api/keepsakes/access/${encodeURIComponent(type)}/${encodeURIComponent(token)}/quotes/${encodeURIComponent(quoteId)}/proofs`;
  return items.flatMap((item, itemIndex) => {
    if (!['PRODIGI', 'LOB'].includes(item.product?.provider)) return [];
    const proofs = [{label: `${item.product.title || 'Keepsake'} · front`, side: 'front', itemIndex, recipientIndex: 0,
      url: `${root}/${itemIndex}/front/0`}];
    if (item.product.provider === 'LOB') for (const [recipientIndex] of (item.recipients || []).entries()) {
      proofs.push({label: `Postcard back · recipient ${recipientIndex + 1} (printer adds address and postage)`,
        side: 'back', itemIndex, recipientIndex, url: `${root}/${itemIndex}/back/${recipientIndex}`});
    }
    return proofs;
  });
}

/** Read-only proof of an unexpired, capability-bound server quote. No arbitrary
 * image URLs, browser specifications or browser artwork enter this renderer.
 */
export async function keepsakesQuoteProof(type, token, quoteId, {itemIndex, side, recipientIndex = 0} = {}) {
  if (!validQuoteId(quoteId) || !validIndex(itemIndex) || !validIndex(recipientIndex) || !['front', 'back'].includes(side)) throw unavailable();
  const [{keepsakesScope, keepsakesSettings,keepsakesSnapshot}, {query}, {verifiedGalleryBytes}, {renderKeepsakesArtwork}] = await Promise.all([
    import('./keepsakes-service.js'), import('../db/pool.js'), import('./gallery-media-delivery.js'), import('./keepsakes-artwork.js')
  ]);
  const scope = await keepsakesScope(type, token);
  const quote = (await query(`SELECT album_id,snapshot FROM keepsakes_quotes
    WHERE id=$1 AND scope_hash=$2 AND album_id=$3 AND expires_at>now()`, [quoteId, scope.scopeHash, scope.albumId])).rows[0];
  if(quote?.snapshot)quote.snapshot=keepsakesSnapshot(quote.snapshot);
  const item = quote?.snapshot?.items?.[itemIndex];
  if (!item || !['PRODIGI', 'LOB'].includes(item.product?.provider) || !Array.isArray(item.assets) || item.assets.length !== 1) throw unavailable();
  if (side === 'back' && (item.product.provider !== 'LOB' || !item.recipients?.[recipientIndex])) throw unavailable();
  if (side === 'front' && recipientIndex !== 0) throw unavailable();

  const ensureCurrentAccess = async () => {
    const current = await keepsakesScope(type, token), settings = await keepsakesSettings(current.albumId);
    if (current.albumId !== quote.album_id || !settings.enabled || !settings.productIds.includes(item.product.id)
        || !item.assets.every(selected => current.assets.some(asset => asset.id === selected.id && asset.media_id === selected.mediaId
          && asset.checksum === selected.checksum && asset.merchandise_eligible && (!asset.branded || settings.brandedMerchandise)))) throw unavailable();
    if (!(await query('SELECT 1 FROM keepsakes_quotes WHERE id=$1 AND scope_hash=$2 AND expires_at>now()', [quoteId, current.scopeHash])).rowCount) throw unavailable();
    return current;
  };
  await ensureCurrentAccess();
  let artwork;
  if (side === 'front') {
    const selected = item.assets[0];
    const media = (await query(`SELECT * FROM gallery_media
      WHERE id=$1 AND album_id=$2 AND checksum=$3 AND status<>'ARCHIVED' AND media_type='IMAGE'`, [selected.mediaId, quote.album_id, selected.checksum])).rows[0];
    if (!media) throw unavailable();
    const bytes = await verifiedGalleryBytes(media, ensureCurrentAccess, {maxBytes: 20 * 1024 * 1024});
    const customization = item.customization || {};
    artwork = (await renderKeepsakesArtwork({bytes, spec: item.variant?.printSpec,
      customization: {...customization, positionX: customization.x, positionY: customization.y}})).buffer;
  } else {
    const [{galleryStorage}, {renderKeepsakesPostcardBack}] = await Promise.all([import('./gallery-storage.js'), import('./keepsakes-lob.js')]);
    const back = (await query(`SELECT * FROM gallery_postcard_back_artworks
      WHERE id=$1 AND album_id=$2 AND status='APPROVED'`, [item.backArtworkId, quote.album_id])).rows[0];
    if (!back || !item.backArtworkChecksum || back.sha256 !== item.backArtworkChecksum) throw unavailable();
    const storage = galleryStorage();
    if (storage.provider !== back.storage_provider) throw unavailable();
    const chunks = []; let size = 0;
    for await (const chunk of await storage.get(back.storage_key)) {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) throw unavailable();
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.backArtworkChecksum) throw unavailable();
    artwork = await renderKeepsakesPostcardBack({bytes, message: item.recipients[recipientIndex].message || '', messageFont:item.recipients[recipientIndex].messageFont, messageColor:item.recipients[recipientIndex].messageColor, messageZone: item.variant?.messageZone});
  }
  const thumbnail = await renderKeepsakesProofThumbnail(artwork);
  await ensureCurrentAccess();
  return thumbnail;
}
