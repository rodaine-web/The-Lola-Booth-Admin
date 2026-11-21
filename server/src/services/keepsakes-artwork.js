import crypto from 'node:crypto';
import sharp from 'sharp';
import {AppError} from '../utils/errors.js';

const MAX_PIXELS = 60_000_000;
const fail = (message, code = 'KEEPSAKES_ARTWORK_INVALID') => {
  throw new AppError(message, 422, code);
};

// The caller must obtain this specification from a verified supplier SKU. This
// renderer deliberately has no default product dimensions or supplier lookup.
export function validateKeepsakesPrintSpec(spec) {
  if (!spec || typeof spec !== 'object') fail('A verified product print specification is required.');
  const {widthPx, heightPx, dpi, bleedPx, safePx} = spec;
  if (![widthPx, heightPx].every(value => Number.isInteger(value) && value > 0 && value <= 12000)
      || widthPx * heightPx > MAX_PIXELS) fail('Print dimensions are invalid or exceed the rendering limit.');
  if (!Number.isInteger(dpi) || dpi < 72 || dpi > 1200) fail('The supplier print DPI is required.');
  if (![bleedPx, safePx].every(value => Number.isInteger(value) && value >= 0)
      || (bleedPx + safePx) * 2 >= Math.min(widthPx, heightPx)) fail('Supplier bleed and safe-area dimensions are invalid.');
  if (spec.allowedFits !== undefined && (!Array.isArray(spec.allowedFits) || !spec.allowedFits.length
      || spec.allowedFits.some(value => !['contain', 'cover'].includes(value)))) fail('Product fitting options are invalid.');
  return {widthPx, heightPx, dpi, bleedPx, safePx,
    allowedFits: spec.allowedFits ? [...new Set(spec.allowedFits)] : ['contain', 'cover']};
}

export function normalizeKeepsakesCustomization(input = {}, spec) {
  const fit = input.fit ?? 'contain';
  const zoom = input.zoom ?? 1;
  const positionX = input.positionX ?? 0.5;
  const positionY = input.positionY ?? 0.5;
  if (!['contain', 'cover'].includes(fit) || !spec.allowedFits.includes(fit)) fail('This image fitting option is not supported by the product.');
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 4
      || ![positionX, positionY].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) fail('Crop and positioning values are invalid.');
  // A contain preview promises the whole source image; zoom would break that.
  if (fit === 'contain' && zoom !== 1) fail('Choose crop-to-fill before zooming the photo.');
  return {fit, zoom, positionX, positionY};
}

/** Render one genuine, authorized source into a supplier's full bleed canvas.
 * `bytes` must already have been obtained through the existing private media
 * authorization/integrity layer. URLs and arbitrary remote fetches are rejected.
 * widthPx/heightPx include bleed; safePx is the inset inside the trim boundary.
 */
export async function renderKeepsakesArtwork({bytes, spec: inputSpec, customization: inputCustomization = {}} = {}) {
  const spec = validateKeepsakesPrintSpec(inputSpec);
  const customization = normalizeKeepsakesCustomization(inputCustomization, spec);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 30 * 1024 * 1024) fail('Provide the authorized source image bytes.');
  let normalized, metadata;
  try {
    const sourceMetadata = await sharp(bytes, {limitInputPixels: MAX_PIXELS}).metadata();
    if (!['jpeg', 'png', 'webp'].includes(sourceMetadata.format) || (sourceMetadata.pages ?? 1) > 1) fail('Use a static JPEG, PNG, or WebP source image.');
    // Re-encoding before the final render strips source EXIF/GPS and handles
    // camera orientation before dimensions and crop calculations are performed.
    normalized = await sharp(bytes, {limitInputPixels: MAX_PIXELS}).rotate().toColourspace('srgb').flatten({background: '#ffffff'}).png().toBuffer();
    metadata = await sharp(normalized).metadata();
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail('The source image could not be decoded.', 'KEEPSAKES_SOURCE_INVALID');
  }
  const {width: sourceWidth, height: sourceHeight} = metadata;
  if (!sourceWidth || !sourceHeight) fail('Source image dimensions are unavailable.');
  const {widthPx, heightPx, dpi, bleedPx, safePx} = spec;
  let canvas, crop, renderedSize;
  if (customization.fit === 'cover') {
    const ratio = widthPx / heightPx;
    let cropWidth = sourceWidth, cropHeight = sourceWidth / ratio;
    if (cropHeight > sourceHeight) {cropHeight = sourceHeight; cropWidth = sourceHeight * ratio;}
    cropWidth = Math.max(1, Math.floor(cropWidth / customization.zoom));
    cropHeight = Math.max(1, Math.floor(cropHeight / customization.zoom));
    crop = {left: Math.round((sourceWidth - cropWidth) * customization.positionX),
      top: Math.round((sourceHeight - cropHeight) * customization.positionY), width: cropWidth, height: cropHeight};
    if (cropWidth < widthPx || cropHeight < heightPx) fail('The selected crop is below the product print resolution. Choose less zoom or a larger original.', 'KEEPSAKES_RESOLUTION_TOO_LOW');
    canvas = sharp(normalized).extract(crop).resize(widthPx, heightPx, {fit: 'fill', withoutEnlargement: true});
    renderedSize = {widthPx, heightPx};
  } else {
    // A finished composite's borders and text must survive the physical trim.
    // Preserve its complete layout inside the supplier's safe area, with white
    // outside it; fitting to the full bleed canvas would sacrifice edge content.
    const inset = bleedPx + safePx;
    const safeWidth = widthPx - 2 * inset, safeHeight = heightPx - 2 * inset;
    const scale = Math.min(safeWidth / sourceWidth, safeHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale));
    if (scale > 1) fail('The image is below the product print resolution. Import a larger original.', 'KEEPSAKES_RESOLUTION_TOO_LOW');
    const image = await sharp(normalized).resize(width, height, {fit: 'fill', withoutEnlargement: true}).png().toBuffer();
    canvas = sharp({create: {width: widthPx, height: heightPx, channels: 3, background: '#ffffff'}})
      .composite([{input: image, left: inset + Math.round((safeWidth - width) * customization.positionX), top: inset + Math.round((safeHeight - height) * customization.positionY)}]);
    renderedSize = {widthPx: width, heightPx: height};
    crop = {left: 0, top: 0, width: sourceWidth, height: sourceHeight};
  }
  const buffer = await canvas.toColourspace('srgb').withMetadata({density: dpi}).png({compressionLevel: 9}).toBuffer();
  return {buffer, mimeType: 'image/png', sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    spec, customization, source: {widthPx: sourceWidth, heightPx: sourceHeight}, crop, renderedSize,
    safeArea: {left: bleedPx + safePx, top: bleedPx + safePx, widthPx: widthPx - 2 * (bleedPx + safePx), heightPx: heightPx - 2 * (bleedPx + safePx)}};
}

// Distinct print areas can select distinct genuine photographs. No individual
// originals are extracted from a composite and no fixed session size is assumed.
export async function renderKeepsakesPrintAreas({areas} = {}) {
  if (!Array.isArray(areas) || !areas.length || areas.length > 20) fail('Provide between one and twenty product print areas.');
  const names = areas.map(area => area?.name);
  if (names.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) || new Set(names).size !== names.length) fail('Print areas require unique valid names.');
  const result = [];
  // Bound memory use for large multi-area products instead of rendering all at once.
  for (const area of areas) result.push({name: area.name, ...await renderKeepsakesArtwork(area)});
  const snapshotHash = crypto.createHash('sha256').update(JSON.stringify(result.map(area => ({name: area.name,
    sha256: area.sha256, sourceSha256: area.sourceSha256, spec: area.spec, customization: area.customization})))).digest('hex');
  return {areas: result, snapshotHash};
}
