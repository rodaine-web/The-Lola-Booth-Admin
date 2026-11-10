/** Approved existing photography for experience previews without a configured image. */
export function experienceImage(name='') {
  const key=name.toLowerCase();
  if(key.includes('mirror'))return '/brand/proposals/approved/redesign-mirror.jpg';
  if(key.includes('360'))return '/brand/proposals/approved/redesign-360.jpg';
  if(key.includes('vogue'))return '/brand/proposals/approved/redesign-vogue.jpg';
  const asset=key.includes('360')?'360':key.includes('vogue')?'vogue':key.includes('audio')?'audio':'glam';
  return `/brand/proposals/${asset}.jpg`;
}
