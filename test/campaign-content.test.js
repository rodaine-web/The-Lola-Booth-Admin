import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignContent, eligibleAudience } from '../shared/campaign-content.js';
import { renderCampaignEmail } from '../server/src/services/campaign-email.js';
import { campaignSchema, interestSchema, newCampaignToken, hashCampaignToken } from '../server/src/services/campaign-service.js';
import { requirePermission } from '../server/src/middleware/auth.js';
const campaign = {
  name: 'QA',
  subject: "{{contact.first_name}}, make {{company.name}}'s year-end celebration unforgettable",
  preview_text: 'Premium year-end experiences',
  content_json: campaignContent({
    mailing_address: 'Synthetic QA address'
  })
};
test('approved campaign pricing and all three packages are preserved', () => {
  const {
    html
  } = renderCampaignEmail(campaign, {
    first_name: 'Jordan',
    company: 'Northstar Group'
  }, {
    token: newCampaignToken(),
    origin: 'https://stagingadmin.thelolabooth.com'
  });
  for (const text of ['$999', '$1,099', '$1,799', 'Save $299', 'Glam $200', '360 $250', 'Duo $350', 'The LOLA Glam', 'The LOLA 360', 'The Year-End Duo', 'Northstar Group', 'Jordan']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('Unsubscribe from marketing'));
  assert.doesNotMatch(html, /<form|<script|data:image|\{\{|\[COMPANY|\[First/i);
  assert.equal((html.match(/alt="[^"]+"/g) || []).length, 4);
  assert.match(html, /max-width:640px/);
  assert.match(html, /@media/);
  assert.match(html, /role="presentation"/);
});
test('recipient and company are safely escaped and subject uses the existing merge engine', () => {
  const out = renderCampaignEmail(campaign, {
    first_name: '<Jordan>',
    company: 'A&B'
  }, {
    test: true
  });
  assert.match(out.html, /&lt;Jordan&gt;/);
  assert.match(out.html, /A&amp;B/);
  assert.equal(out.subject, "<Jordan>, make A&B's year-end celebration unforgettable");
});
test('missing recipient fields have safe greeting, heading and subject fallbacks', () => {
  const out = renderCampaignEmail(campaign, {}, {
    test: true
  });
  assert.match(out.html, />Hello,/);
  assert.match(out.html, /FOR YOUR TEAM/);
  assert.equal(out.subject, 'Make Your Year-End Celebration Unforgettable');
  assert.doesNotMatch(out.html, /undefined|null|\[COMPANY|\{\{/);
});
test('package CTAs preselect experiences and bottom CTA does not select one', () => {
  const token = newCampaignToken(),
    out = renderCampaignEmail(campaign, {}, {
      token,
      test: true
    });
  for (const p of ['GLAM', '360', 'DUO']) assert.ok(out.html.includes('/interest/' + token + '?package=' + p));
  assert.ok(out.html.includes('/interest/' + token + '"'));
  assert.ok(out.html.includes('/unsubscribe/' + token));
});
test('test banner is present only in test sends', () => {
  assert.match(renderCampaignEmail(campaign, {}, {
    test: true
  }).html, /TEST EMAIL/);
  assert.doesNotMatch(renderCampaignEmail(campaign, {}).html, /TEST EMAIL/);
});
test('assets cannot point to insecure hosts in live emails', () => {
  assert.throws(() => renderCampaignEmail({
    ...campaign,
    content_json: campaignContent({
      images: {
        hero: 'http://localhost/photo.jpg'
      }
    })
  }, {}), /HTTPS/);
});
test('audiences normalize email and exclude duplicate, missing, nonconsented, hard-bounced and suppressed contacts', () => {
  const base = {
    marketing_email_opt_in: true
  };
  const out = eligibleAudience([{
    ...base,
    email: ' A@EXAMPLE.COM ',
    first_name: 'A'
  }, {
    ...base,
    email: 'a@example.com'
  }, {
    email: 'b@example.com'
  }, {
    ...base,
    email: ''
  }, {
    ...base,
    email: 'c@example.com',
    communication_preferences: {
      marketing_email: false
    }
  }, {
    ...base,
    email: 'd@example.com',
    hard_bounced_at: 'now'
  }, {
    ...base,
    email: 'e@example.com'
  }], ['e@example.com']);
  assert.equal(out.count, 1);
  assert.equal(out.recipients[0].email, 'a@example.com');
  assert.deepEqual(out.excluded.map(x => x.reason), ['Duplicate email', 'No marketing consent', 'Missing or invalid email', 'Unsubscribed', 'Hard bounce', 'Suppressed']);
});
test('company resolution prioritizes explicit association before lead company and organization', () => {
  const out = eligibleAudience([{
    email: 'a@example.com',
    marketing_email_opt_in: true,
    associated_company: 'Primary',
    company: 'Lead',
    organization: 'Organization'
  }]);
  assert.equal(out.recipients[0].company, 'Primary');
});
test('opaque tokens are random, 256-bit and hashes cannot reveal token', () => {
  const a = newCampaignToken(),
    b = newCampaignToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(hashCampaignToken(a).length, 64);
  assert.notEqual(hashCampaignToken(a), a);
});
test('interest validates package, actual calendar date, event time, size and honeypot', () => {
  const valid = {
    package: '360',
    event_date: '2099-12-20',
    event_time: '18:30'
  };
  assert.ok(interestSchema.safeParse(valid).success);
  for (const change of [{
    package: 'BOOKED'
  }, {
    event_date: '2020-12-20'
  }, {
    event_date: '2099-02-30'
  }, {
    event_time: '25:00'
  }, {
    website: 'spam'
  }, {
    location: 'a'.repeat(301)
  }]) assert.equal(interestSchema.safeParse({
    ...valid,
    ...change
  }).success, false);
});
test('draft schema rejects invalid addresses and strips delivery state during duplication', () => {
  const parsed = campaignSchema.parse({
    ...campaign,
    status: 'SENT',
    recipients: ['x'],
    metrics: {
      sent: 1
    }
  });
  assert.equal(parsed.status, undefined);
  assert.equal(parsed.recipients, undefined);
  assert.equal(parsed.metrics, undefined);
  assert.equal(campaignSchema.safeParse({
    ...campaign,
    reply_to: 'not-email'
  }).success, false);
});
test('campaign permissions distinguish reading from sending', () => {
  let error;
  requirePermission('campaigns.send')({
    user: {
      permissions: ['campaigns.read']
    }
  }, {}, e => error = e);
  assert.equal(error.statusCode, 403);
  error = 'unchanged';
  requirePermission('campaigns.read')({
    user: {
      permissions: ['campaigns.read']
    }
  }, {}, e => error = e);
  assert.equal(error, undefined);
});
