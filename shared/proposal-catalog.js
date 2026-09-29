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
