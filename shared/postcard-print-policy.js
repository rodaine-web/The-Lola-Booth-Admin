export function lobPrintTestEnabled(config = {}) {
  const environment = config.APP_ENV || config.NODE_ENV;
  return ['development','test'].includes(environment)
    || environment === 'staging' && config.LOB_STAGING_TEST_ENABLED === 'true'
    || environment === 'production' && config.LOB_PRODUCTION_TEST_ENABLED === 'true';
}

// Complete 4×6 layouts only. A pixel-density tag cannot rescue a small source.
export function postcardFrontProfile(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    return {eligible:false,reason:'Photo dimensions are invalid.'};
  const long = Math.max(width,height), short = Math.min(width,height), ratio = long / short;
  const kind = Math.abs(ratio - 1875/1275) < 0.005 ? 'BLEED_READY'
    : Math.abs(ratio - 1.5) < 0.005 ? 'TRIM_READY' : null;
  if (!kind) return {eligible:false,reason:'Use a finished 4×6 photo layout. Narrow strips and other formats cannot be mailed.'};
  const minimum = kind === 'BLEED_READY' ? [1875,1275] : [1800,1200];
  if (long < minimum[0] || short < minimum[1])
    return {eligible:false,reason:'The photo is below 300-DPI print resolution for 4×6. Import the full-resolution original.'};
  return {eligible:true,kind,rotation:width < height ? 90 : 0};
}
