export const campaignPackages = ['GLAM', '360', 'DUO'];
export const campaignDefaults = {
  format: 'CORPORATE',
  text_body: '',
  html_body: '',
  offers: [],
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
  return ((!recipient.first_name && subject.includes('{{contact.first_name}}')) || (!recipient.company && subject.includes('{{company.name}}'))) ? 'Make Your Year-End Celebration Unforgettable' : subject;
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

export function campaignOfferPrice(offer) {
  const cents = Math.round(Number(offer.original_price || 0) * 100);
  const value = Number(offer.discount_value || 0);
  const reduction = offer.discount_type === 'PERCENT' ? Math.round(cents * value / 100) : offer.discount_type === 'AMOUNT' ? Math.round(value * 100) : 0;
  return { original: cents / 100, discounted: Math.max(0, cents - reduction) / 100, saving: Math.min(cents, reduction) / 100 };
}
export function campaignInterestOptions(content) {
  const c = campaignContent(content);
  if (c.format === 'CORPORATE') return campaignPackages.map(key => ({key, name: key === 'GLAM' ? 'The LOLA Glam' : key === '360' ? 'The LOLA 360' : 'The Year-End Duo', price: c[key === 'GLAM' ? 'glam_price' : key === '360' ? '360_price' : 'duo_price']}));
  const experiences = c.offers.filter(o => o.kind === 'EXPERIENCE');
  return experiences.length ? experiences.map(o => ({key:o.key,name:o.name,price:campaignOfferPrice(o).discounted})) : [{key:'GENERAL',name:'Tell me more',price:null}];
}

export function campaignPackageOffer(offer,pkg) {
  return {...offer,package_id:pkg.id,original_price:Number(pkg.starting_price ?? pkg.price ?? offer.original_price),hours:Number(pkg.included_hours ?? pkg.duration ?? offer.hours),description:pkg.proposal_description||pkg.description||offer.description};
}

// Expand an explicit catalog rule; never apply the planner rate to unrelated experiences.
export function expandCampaignPackageOffers(offers, experiences, packages) {
  return offers.flatMap(offer => {
    if (offer.package_scope !== 'ALL_REGULAR') return [offer];
    const experience = experiences.find(e => e.id === offer.catalog_id && e.active !== false && e.is_active !== false && !e.deleted_at);
    if (!experience) return [];
    return packages.filter(p => p.experience_id === experience.id && !/^custom(?:\s|$)/i.test(p.name || '') && Number(p.starting_price ?? p.price) > 0 && p.active !== false && p.is_active !== false && !p.deleted_at)
      .map(pkg => ({...campaignPackageOffer(offer, pkg), package_scope:'SINGLE', key:`${offer.key}_PACKAGE_${pkg.id}`, name:`${experience.website_name || experience.name} — ${pkg.name}`, features:pkg.items || pkg.website_features || [], image_url:offer.image_url || experience.image_url || ''}));
  });
}
