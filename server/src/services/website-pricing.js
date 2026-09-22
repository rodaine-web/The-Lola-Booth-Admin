export function projectWebsitePackage(row, { showStartingPrice = true } = {}) {
  const custom = row.pricing_mode === 'CUSTOM' || /^(the\s+)?custom$/i.test(row.name || '');
  const value = row.starting_price == null ? null : Number(row.starting_price);
  return {
    ...row,
    starting_price: custom ? null : value,
    pricing_mode: custom ? 'CUSTOM' : 'STARTING',
    display_price: custom ? 'Custom' : !showStartingPrice ? 'Request Pricing' : value,
    website_features: Array.isArray(row.website_features) ? row.website_features : []
  };
}
