export const campaignPackages = ['GLAM', '360', 'DUO'];
export const campaignDefaults = {
  headline: 'Make Your Year-End Celebration One to Remember',
  intro: 'Bring your team together with a polished photo experience, a high-energy 360 moment, or both.',
  cta: "I'M INTERESTED",
  glam_price: 999,
  '360_price': 1099,
  duo_price: 1799,
  duo_features:['Everything in The LOLA Glam','Everything in The LOLA 360','Complete photo + video experience','Two simultaneous guest experiences','Ideal for larger celebrations'],
  glam_extra: 200,
  '360_extra': 250,
  duo_extra: 350,
  glam_features: ['Premium backdrop', 'Studio lighting', 'Black & white or color glam finish', 'Custom branded photo overlay', 'Personalized welcome screen', 'Instant text, email & AirDrop sharing', 'Professional attendant', 'Setup & breakdown'],
  '360_features': ['360 slow-motion video', 'Custom branded video overlay', 'Lighting & visual effects', 'Fun event props', 'Instant sharing', 'Professional attendant', 'Setup & breakdown'],
  footer: '773-240-2744 · info@thelolabooth.com · thelolabooth.com',
  mailing_address: '',
  images: {
    logo: '/campaigns/year-end-2026/logo.png',
    hero: '/campaigns/year-end-2026/hero.jpg',
    glam: '/campaigns/year-end-2026/glam.jpg',
    '360': '/campaigns/year-end-2026/360.jpg'
  }
};
export function campaignContent(input = {}) {
  return {
    ...campaignDefaults,
    ...input,
    images: {
      ...campaignDefaults.images,
      ...input.images
    }
  };
}
export function campaignSubject(subject, recipient) {
  return !recipient.first_name || !recipient.company ? 'Make Your Year-End Celebration Unforgettable' : subject;
}
export function eligibleAudience(contacts = [], suppressed = []) {
  const blocked = new Set(suppressed.map(x => String(x.email || x).trim().toLowerCase()));
  const byEmail = new Map(),
    excluded = [];
  for (const c of contacts) {
    const email = String(c.email || '').trim().toLowerCase(),
      p = c.communication_preferences || {};
    let reason = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Missing or invalid email' : blocked.has(email) ? 'Suppressed' : c.marketing_email_opt_in !== true ? 'No marketing consent' : p.marketing_email === false || p.marketing_email_opt_in === false || p.unsubscribed === true ? 'Unsubscribed' : c.hard_bounced_at || p.hard_bounced ? 'Hard bounce' : null;
    if (reason) {
      excluded.push({
        ...c,
        email,
        reason
      });
      continue;
    }
    if (byEmail.has(email)) {
      excluded.push({
        ...c,
        email,
        reason: 'Duplicate email'
      });
      continue;
    }
    byEmail.set(email, {
      ...c,
      email,
      first_name: c.first_name || String(c.name || '').split(' ')[0] || '',
      last_name: c.last_name || String(c.name || '').split(' ').slice(1).join(' '),
      company: c.associated_company || c.company || c.organization || ''
    });
  }
  return {
    recipients: [...byEmail.values()],
    excluded,
    count: byEmail.size
  };
}
