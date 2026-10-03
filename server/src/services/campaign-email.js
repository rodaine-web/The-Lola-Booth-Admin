import { readFileSync } from 'node:fs';
import { campaignContent, campaignSubject } from '../../../shared/campaign-content.js';
import {AppError} from '../utils/errors.js';
import { renderTemplate } from './automation-service.js';
const template = readFileSync(new URL('../templates/corporate-year-end.html', import.meta.url), 'utf8');
export function escapeEmail(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}
export function campaignOrigin() {
  return (process.env.CAMPAIGN_PUBLIC_ORIGIN || process.env.CLIENT_ORIGIN || 'https://stagingadmin.thelolabooth.com').replace(/\/$/, '');
}
export function renderCampaignEmail(campaign, recipient = {}, {
  token = 'preview',
  test = false,
  origin = campaignOrigin()
} = {}) {
  if(!test){const publicUrl=new URL(origin);if(publicUrl.protocol!=='https:'||/^(localhost|127\.|\[::1\])/.test(publicUrl.hostname))throw new AppError('Campaign public origin must use public HTTPS.',422,'INVALID_CAMPAIGN_ORIGIN');}
  const c = campaignContent(campaign.content_json),
    money = n => '$' + Number(n).toLocaleString('en-US'),
    vars = {};
  for (const [key, path] of Object.entries(c.images)) {
    const url = new URL(path, origin);
    if(!test&&(url.protocol!=='https:'||url.username||url.password||/^(localhost|127\.|\[::1\])/.test(url.hostname)))throw new AppError('Campaign assets must use public HTTPS.',422,'INVALID_CAMPAIGN_ASSET');
    vars['asset.' + key] = escapeEmail(url.href);
  }
  Object.assign(vars, {
    salutation: recipient.first_name ? 'Hi <strong>' + escapeEmail(recipient.first_name) + '</strong>,' : 'Hello,',
    interest_name: escapeEmail(recipient.first_name || 'READY'),
    company_heading: recipient.company ? 'A YEAR-END EXPERIENCE FOR ' + escapeEmail(recipient.company) : 'A YEAR-END EXPERIENCE FOR YOUR TEAM',
    headline: escapeEmail(c.headline),
    intro: escapeEmail(c.intro),
    preview: escapeEmail(campaign.preview_text),
    cta: escapeEmail(c.cta),
    footer: escapeEmail(c.footer),
    mailing_address: escapeEmail(c.mailing_address),
    glam_price: money(c.glam_price),
    '360_price': money(c['360_price']),
    duo_price: money(c.duo_price),
    savings: money(Math.max(0, c.glam_price + c['360_price'] - c.duo_price)),
    extra_hours: `Glam ${money(c.glam_extra)} · 360 ${money(c['360_extra'])} · Duo ${money(c.duo_extra)}`,
    duo_features:c.duo_features.map(f=>'✓ '+escapeEmail(f)).join('<br>'),
    glam_features: c.glam_features.map(f => '✓ ' + escapeEmail(f)).join('<br>'),
    '360_features': c['360_features'].map(f => '✓ ' + escapeEmail(f)).join('<br>'),
    interest_url: escapeEmail(origin + '/interest/' + token),
    unsubscribe_url: escapeEmail(origin + '/unsubscribe/' + token),
    test_banner: test ? '<div style="background:#171717;color:white;text-align:center;padding:10px;font:12px Arial">TEST EMAIL — sample recipient data</div>' : ''
  });
  const html = template.replace(/\{\{([\w.]+)\}\}/g, (_, key) => vars[key] ?? '');
  const contact = {
    first_name: recipient.first_name || '',
    last_name: recipient.last_name || '',
    full_name: [recipient.first_name, recipient.last_name].filter(Boolean).join(' '),
    email: recipient.email || ''
  };
  const subject = renderTemplate(campaignSubject(campaign.subject, recipient), {
    contact,
    company: {
      name: recipient.company || ''
    }
  });
  return {
    html,
    subject,
    text: `${c.headline}\n${c.intro}\nLOLA Glam ${money(c.glam_price)} · LOLA 360 ${money(c['360_price'])} · Duo ${money(c.duo_price)}\n${origin}/interest/${token}\nUnsubscribe: ${origin}/unsubscribe/${token}`
  };
}
