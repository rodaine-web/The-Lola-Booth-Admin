/** Approved existing photography for experience previews without a configured image. */
export function experienceImage(name='') {
  const key=name.toLowerCase();
  const asset=key.includes('360')?'360':key.includes('vogue')?'vogue':key.includes('audio')?'audio':'glam';
  return `/brand/proposals/${asset}.jpg`;
}
