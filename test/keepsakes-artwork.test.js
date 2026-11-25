import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {renderKeepsakesArtwork, renderKeepsakesPrintAreas, validateKeepsakesPrintSpec} from '../server/src/services/keepsakes-artwork.js';

const spec = {widthPx: 120, heightPx: 80, dpi: 300, bleedPx: 2, safePx: 3};
const source = (width = 240, height = 160, background = '#a02030') => sharp({create: {width, height, channels: 3, background}}).png().toBuffer();

test('print artwork has exact verified dimensions, DPI, safe area and stable immutable hashes', async () => {
  const bytes = await source();
  const a = await renderKeepsakesArtwork({bytes, spec});
  const b = await renderKeepsakesArtwork({bytes, spec});
  const metadata = await sharp(a.buffer).metadata();
  assert.equal(metadata.width, 120);
  assert.equal(metadata.height, 80);
  assert.equal(metadata.density, 300);
  assert.equal(a.sha256, b.sha256);
  assert.deepEqual(a.safeArea, {left: 5, top: 5, widthPx: 110, heightPx: 70});
  assert.equal(a.customization.fit, 'contain');
});

test('contain preserves every side of a composite instead of inventing individual originals', async () => {
  const bands = await sharp({create: {width: 240, height: 160, channels: 3, background: '#00ff00'}})
    .composite([{input: await source(40, 160, '#ff0000'), left: 0, top: 0}, {input: await source(40, 160, '#0000ff'), left: 200, top: 0}]).png().toBuffer();
  const result = await renderKeepsakesArtwork({bytes: bands, spec: {...spec, widthPx: 120, heightPx: 120}});
  const {data, info} = await sharp(result.buffer).raw().toBuffer({resolveWithObject: true});
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.deepEqual(pixel(7, 60), [255, 0, 0]);
  assert.deepEqual(pixel(112, 60), [0, 0, 255]);
  assert.deepEqual(pixel(60, 2), [255, 255, 255]);
  for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
    if (x < 5 || x >= 115 || y < 5 || y >= 115) assert.deepEqual(pixel(x, y), [255, 255, 255], `Safe border must be white at ${x},${y}`);
  }
});

test('contain positioning keeps all four distinctive composite edges inside both bleed and safe margins', async () => {
  const edge = async (width, height, color) => sharp({create: {width, height, channels: 3, background: color}}).png().toBuffer();
  const bytes = await sharp(await source(240, 160, '#888888')).composite([
    {input: await edge(240, 16, '#ff0000'), left: 0, top: 0},
    {input: await edge(240, 16, '#0000ff'), left: 0, top: 144},
    {input: await edge(16, 128, '#00ff00'), left: 0, top: 16},
    {input: await edge(16, 128, '#ffff00'), left: 224, top: 16}
  ]).png().toBuffer();
  for (const position of [0, 1]) {
    const result = await renderKeepsakesArtwork({bytes, spec, customization: {fit: 'contain', positionX: position, positionY: position}});
    const {data, info} = await sharp(result.buffer).raw().toBuffer({resolveWithObject: true});
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const left = result.safeArea.left + (result.safeArea.widthPx - result.renderedSize.widthPx) * position;
    const top = result.safeArea.top + (result.safeArea.heightPx - result.renderedSize.heightPx) * position;
    assert.deepEqual(pixel(left + 40, top + 2), [255, 0, 0]);
    assert.deepEqual(pixel(left + 40, top + result.renderedSize.heightPx - 3), [0, 0, 255]);
    assert.deepEqual(pixel(left + 2, top + 35), [0, 255, 0]);
    assert.deepEqual(pixel(left + result.renderedSize.widthPx - 3, top + 35), [255, 255, 0]);
    for (let y = 0; y < spec.heightPx; y++) for (let x = 0; x < spec.widthPx; x++) {
      if (x < 5 || x >= 115 || y < 5 || y >= 75) assert.deepEqual(pixel(x, y), [255, 255, 255]);
    }
  }
});

test('crop position and zoom change actual print pixels and snapshot hash', async () => {
  const bytes = await sharp({create: {width: 480, height: 160, channels: 3, background: '#0000ff'}})
    .composite([{input: await source(240, 160, '#ff0000'), left: 0, top: 0}]).png().toBuffer();
  const left = await renderKeepsakesArtwork({bytes, spec, customization: {fit: 'cover', positionX: 0}});
  const right = await renderKeepsakesArtwork({bytes, spec, customization: {fit: 'cover', positionX: 1}});
  assert.notEqual(left.sha256, right.sha256);
  assert.equal(left.crop.left, 0);
  assert.equal(right.crop.left, 240);
  const zoomed = await renderKeepsakesArtwork({bytes, spec, customization: {fit: 'cover', zoom: 2}});
  assert.equal(zoomed.crop.width, 120);
  assert.equal(zoomed.crop.height, 80);
});

test('source resolution and crop resolution are enforced without upscaling', async () => {
  await assert.rejects(renderKeepsakesArtwork({bytes: await source(60, 40), spec}), {code: 'KEEPSAKES_RESOLUTION_TOO_LOW'});
  await assert.rejects(renderKeepsakesArtwork({bytes: await source(), spec, customization: {fit: 'cover', zoom: 3}}), {code: 'KEEPSAKES_RESOLUTION_TOO_LOW'});
});

test('rejects missing specifications, URL inputs, unsupported fits and malformed coordinates', async () => {
  assert.throws(() => validateKeepsakesPrintSpec({widthPx: 120, heightPx: 80}), {code: 'KEEPSAKES_ARTWORK_INVALID'});
  await assert.rejects(renderKeepsakesArtwork({bytes: 'https://example.com/private.jpg', spec}), {code: 'KEEPSAKES_ARTWORK_INVALID'});
  await assert.rejects(renderKeepsakesArtwork({bytes: await source(), spec, customization: {fit: 'cover', positionX: 2}}), {code: 'KEEPSAKES_ARTWORK_INVALID'});
  await assert.rejects(renderKeepsakesArtwork({bytes: await source(), spec: {...spec, allowedFits: ['contain']}, customization: {fit: 'cover'}}), {code: 'KEEPSAKES_ARTWORK_INVALID'});
  await assert.rejects(renderKeepsakesArtwork({bytes: Buffer.from('bad image'), spec}), {code: 'KEEPSAKES_SOURCE_INVALID'});
});

for (const count of [1, 2, 3, 4, 6]) test(`supports ${count} genuine selected assets without assuming a four-photo layout`, async () => {
  const bytes = await source();
  const result = await renderKeepsakesPrintAreas({areas: Array.from({length: count}, (_, i) => ({name: `area_${i}`, bytes, spec}))});
  assert.equal(result.areas.length, count);
  assert.match(result.snapshotHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.areas.map(area => area.name), Array.from({length: count}, (_, i) => `area_${i}`));
});

test('multiple print areas require unique names', async () => {
  const bytes = await source();
  await assert.rejects(renderKeepsakesPrintAreas({areas: [{name: 'front', bytes, spec}, {name: 'front', bytes, spec}]}), {code: 'KEEPSAKES_ARTWORK_INVALID'});
});
