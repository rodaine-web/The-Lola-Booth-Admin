import { AppError } from '../utils/errors.js';
import { checkedRedirect, mailchimpOrigin, providerRequest } from './external-provider-security.js';
export const EXTERNAL_PROVIDERS = ['META', 'TIKTOK', 'GA4', 'MAILCHIMP'];
export const providerSlugs = {
  META: 'meta',
  TIKTOK: 'tiktok',
  GA4: 'google-analytics',
  MAILCHIMP: 'mailchimp'
};
export function externalProvider(slug) {
  const p = Object.keys(providerSlugs).find(p => providerSlugs[p] === slug || p === slug);
  if (!p) throw new AppError('Unknown integration.', 404, 'INTEGRATION_UNSUPPORTED');
  return p;
}
export function providerConfig(provider) {
  const prefix = provider === 'GA4' ? 'GOOGLE' : provider;
  const id = process.env[`${prefix}_CLIENT_ID`] || '',
    secret = process.env[`${prefix}_CLIENT_SECRET`] || '';
  const redirect = process.env[provider === 'GA4' ? 'GOOGLE_ANALYTICS_REDIRECT_URI' : `${prefix}_REDIRECT_URI`] || '';
  const version = process.env.META_GRAPH_VERSION || 'v24.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new AppError('Invalid Meta API version.', 422, 'PROVIDER_CONFIG_INVALID');
  return {
    id,
    secret,
    redirect,
    version,
    ready: Boolean(id && secret && redirect && process.env.INTEGRATION_SECRET_KEY?.length >= 32),
    approved: provider !== 'TIKTOK' || process.env.TIKTOK_LEAD_ACCESS_APPROVED === 'true'
  };
}
export function oauthUrl(provider, state, verifier) {
  const c = providerConfig(provider);
  if (!c.ready) throw new AppError('Complete the server credentials and encryption key before connecting.', 422, 'PROVIDER_NOT_CONFIGURED');
  if (!c.approved) throw new AppError('TikTok Lead Generation access requires approval in your Business developer app.', 422, 'PROVIDER_APPROVAL_REQUIRED');
  const redirect = checkedRedirect(c.redirect, providerSlugs[provider]);
  const urls = {
    GA4: 'https://accounts.google.com/o/oauth2/v2/auth',
    MAILCHIMP: 'https://login.mailchimp.com/oauth2/authorize',
    META: `https://www.facebook.com/${c.version}/dialog/oauth`,
    TIKTOK: 'https://business-api.tiktok.com/portal/auth'
  };
  const u = new URL(urls[provider]);
  u.search = new URLSearchParams({
    [provider === 'TIKTOK' ? 'app_id' : 'client_id']: c.id,
    redirect_uri: redirect,
    state,
    response_type: 'code'
  });
  if (provider === 'GA4') for (const [k, v] of Object.entries({
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: verifier.challenge,
    code_challenge_method: 'S256'
  })) u.searchParams.set(k, v);
  if (provider === 'META') u.searchParams.set('scope', 'pages_show_list,pages_read_engagement,pages_manage_metadata,leads_retrieval,instagram_basic');
  return u.toString();
}
export async function exchangeCode(provider, code, verifier, fetcher) {
  const c = providerConfig(provider),
    redirect = checkedRedirect(c.redirect, providerSlugs[provider]);
  if (provider === 'TIKTOK') {
    const r = await providerRequest('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
      method: 'POST',
      body: {
        app_id: c.id,
        secret: c.secret,
        auth_code: code
      },
      fetcher
    });
    return r.data;
  }
  const urls = {
    GA4: 'https://oauth2.googleapis.com/token',
    MAILCHIMP: 'https://login.mailchimp.com/oauth2/token',
    META: `https://graph.facebook.com/${c.version}/oauth/access_token`
  };
  const body = new URLSearchParams({
    client_id: c.id,
    client_secret: c.secret,
    redirect_uri: redirect,
    code,
    grant_type: 'authorization_code',
    ...(provider === 'GA4' ? {
      code_verifier: verifier
    } : {})
  });
  const r = await providerRequest(urls[provider], {
    method: 'POST',
    body,
    fetcher
  });
  if (provider === 'META') {
    const long = await providerRequest(urls.META, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: c.id,
        client_secret: c.secret,
        fb_exchange_token: r.access_token
      }),
      fetcher
    });
    return {
      ...r,
      ...long
    };
  }
  return r;
}
export async function refreshGoogle(tokens, fetcher) {
  const c = providerConfig('GA4');
  if (!tokens.refresh_token) throw new AppError('Reconnect Google Analytics.', 422, 'PROVIDER_AUTH_EXPIRED');
  return providerRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token
    }),
    fetcher
  });
}
export function providerApi(provider, tokens, path, options = {}) {
  if (provider === 'MAILCHIMP') return providerRequest(`${mailchimpOrigin(tokens.dc)}${path}`, {
    ...options,
    token: tokens.access_token
  });
  if (provider === 'META') return providerRequest(`https://graph.facebook.com/${providerConfig('META').version}${path}`, {
    ...options,
    token: tokens.access_token
  });
  if (provider === 'TIKTOK') return providerRequest(`https://business-api.tiktok.com/open_api/v1.3${path}`, {
    ...options,
    headers: {
      ...options.headers,
      'Access-Token': tokens.access_token
    }
  });
  return providerRequest(`https://${path.startsWith('/v1beta/account') || /^\/v1beta\/properties\/\d+$/.test(path) ? 'analyticsadmin' : 'analyticsdata'}.googleapis.com${path}`, {
    ...options,
    token: tokens.access_token
  });
}
export async function accountOptions(provider, tokens, fetcher) {
  if (provider === 'GA4') {
    let next = '',
      options = [];
    do {
      const r = await providerApi(provider, tokens, `/v1beta/accountSummaries?pageSize=200${next ? `&pageToken=${encodeURIComponent(next)}` : ''}`, {
        fetcher
      });
      options.push(...(r.accountSummaries || []).flatMap(a => (a.propertySummaries || []).map(p => ({
        id: p.property.split('/').at(-1),
        name: p.displayName,
        account_id: a.account,
        account_name: a.displayName
      }))));
      next = r.nextPageToken || '';
    } while (next);
    return options;
  }
  if (provider === 'MAILCHIMP') {
    let options = [],
      offset = 0,
      r;
    do {
      r = await providerApi(provider, tokens, `/lists?count=100&offset=${offset}`, {
        fetcher
      });
      options.push(...(r.lists || []).map(a => ({
        id: a.id,
        name: a.name,
        members: a.stats?.member_count
      })));
      offset += 100;
    } while (offset < (r.total_items || 0));
    return options;
  }
  if (provider === 'META') {
    // Pagination URL is never fetched verbatim: only the cursor is used on our fixed host.
    let options = [],
      after = '',
      r;
    do {
      r = await providerApi(provider, tokens, `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, {
        fetcher
      });
      options.push(...(r.data || []).map(p => ({
        id: p.id,
        name: p.name,
        instagram_account_id: p.instagram_business_account?.id,
        instagram_username: p.instagram_business_account?.username,
        page_token: p.access_token
      })));
      after = r.paging?.next ? r.paging?.cursors?.after : '';
    } while (after);
    return options;
  }
  const c = providerConfig('TIKTOK');
  const r = await providerApi(provider, tokens, `/oauth2/advertiser/get/?app_id=${encodeURIComponent(c.id)}&secret=${encodeURIComponent(c.secret)}`, {
    fetcher
  });
  return (r.data?.list || []).map(a => ({
    id: a.advertiser_id,
    name: a.advertiser_name
  }));
}
export async function identity(provider, tokens, fetcher) {
  if (provider === 'MAILCHIMP') {
    const m = await providerRequest('https://login.mailchimp.com/oauth2/metadata', {
      token: tokens.access_token,
      fetcher
    });
    mailchimpOrigin(m.dc);
    tokens.dc = m.dc;
    const root = await providerApi(provider, tokens, '/', {
      fetcher
    });
    return {
      id: String(root.account_id),
      name: root.account_name,
      dc: m.dc
    };
  }
  if (provider === 'META') {
    const m = await providerApi(provider, tokens, '/me?fields=id,name', {
      fetcher
    });
    const p = await providerApi(provider, tokens, '/me/permissions', {
      fetcher
    });
    return {
      id: m.id,
      name: m.name,
      scopes: (p.data || []).filter(x => x.status === 'granted').map(x => x.permission)
    };
  }
  const options = await accountOptions(provider, tokens, fetcher);
  return {
    id: provider === 'GA4' ? 'google-authorized' : String(tokens.advertiser_ids?.[0] || options[0]?.id || ''),
    name: provider === 'GA4' ? 'Select a GA4 property' : 'Select a TikTok advertiser'
  };
}
