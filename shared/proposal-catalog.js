export function selectProposalPackage(form, pack) {
  if (!pack) return {...form, package_id:'', package_amount:''};
  return {...form, package_id:pack.id, experience_id:pack.experience_id || form.experience_id, package_amount:pack.pricing_mode === 'CUSTOM' ? '' : pack.starting_price ?? ''};
}
export function selectProposalExperience(form, experienceId) {
  return experienceId === form.experience_id ? form : {...form,experience_id:experienceId || '',package_id:'',package_amount:''};
}
export function proposalCatalogError(input, pack, addons) {
  if (pack?.experience_id && input.experience_id && pack.experience_id !== input.experience_id) return 'Choose a package belonging to the selected experience.';
  if (pack?.pricing_mode === 'CUSTOM' && !(Number(input.package_amount) > 0)) return 'Enter the agreed custom package price before creating a customer document.';
  for (const selected of input.addons || []) {
    const addon = addons.find(row => row.id === selected.addon_id);
    if (addon?.pricing_type === 'CUSTOM' && !(Number(selected.unit_price) > 0)) return `Enter the agreed price for ${addon.name} before creating a customer document.`;
  }
  return null;
}

// Use catalog keys, not display names: similar names may represent extra units.
export function proposalAddonStatus(addon, experiences, packages) {
  const policy=addon?.pricing_policy;
  if (!policy) return null;
  const selected=experiences.flatMap(item=>item.packages||[])
    .map(item=>({...packages.find(pkg=>pkg.id===item.package_id),...item}));
  if(policy.category==='TRAVEL')return 'Enter the amount in Travel charge.';
  const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const campaign=selected.find(pkg=>pkg.campaign_id&&(pkg.features||[]).some(feature=>[normalize(addon.name),normalize(policy.key)].includes(normalize(typeof feature==='string'?feature:feature.label))));
  if(campaign)return `Included in selected campaign: ${campaign.name}`;
  const included=selected.find(pkg=>pkg.pricing_profile?.includedAddonKeys?.includes(policy.key)
    && policy.experiences?.includes(pkg.pricing_profile.experience)
    && (!policy.packageIds?.length||policy.packageIds.includes(pkg.id)));
  if (included) return `Included in selected package: ${included.name}`;
  if (policy.category==='PRINTS' && selected.some(pkg=>['glam','mirror','vogue'].includes(pkg.pricing_profile?.experience)))
    return 'Select additional prints under Total physical prints in Package pricing review.';
  return null;
}
export function removeIncludedProposalAddons(selected, experiences, packages, addons) {
  const next=selected.filter(item=>!proposalAddonStatus(addons.find(addon=>addon.id===item.addon_id),experiences,packages));
  return next.length===selected.length?selected:next;
}
