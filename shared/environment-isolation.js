export const environments = {
  production: { website: 'https://thelolabooth.com', admin: 'https://admin.thelolabooth.com', api: 'https://api.thelolabooth.com', origins: ['https://thelolabooth.com', 'https://www.thelolabooth.com', 'https://admin.thelolabooth.com'] },
  staging: { website: 'https://staging.thelolabooth.com', admin: 'https://stagingadmin.thelolabooth.com', api: 'https://stagingapi.thelolabooth.com', origins: ['https://staging.thelolabooth.com', 'https://stagingadmin.thelolabooth.com'] }
};

export function assertApiBase(environment, apiBase) {
  const expected = environments[environment];
  if (expected && apiBase !== `${expected.api}/api`) throw new Error(`${environment} Admin must use its own API: ${expected.api}/api`);
}

export function assertEnvironmentIsolation(config) {
  const expected = environments[config.APP_ENV];
  if (!expected) return;
  for (const [key, value] of Object.entries({CLIENT_ORIGIN: expected.admin, PUBLIC_APP_URL: expected.admin, PUBLIC_BASE_URL: expected.website, PUBLIC_DOCUMENT_BASE_URL: expected.website})) {
    if (config[key] !== value) throw new Error(`${key} must equal ${value} for ${config.APP_ENV}.`);
  }
  const origins = String(config.PUBLIC_INQUIRY_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.includes(expected.website) || origins.some(origin => !expected.origins.includes(origin))) throw new Error('Public inquiry origins must belong to this environment.');
}

export function originAllowed(environment, origin, fallbackOrigins = []) {
  return !origin || (environments[environment]?.origins || fallbackOrigins).includes(origin);
}
