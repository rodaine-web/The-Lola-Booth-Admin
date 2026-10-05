// Reviewed supplied photography. Order: hero, equipment, guest interface, output.
export const proposalPhotoMapping = {
  glam: [
    ['ED68B6B7-A252-445E-BD35-2D5B622278DF', 'Guests using the Glam camera booth'],
    ['CC3DE7AA-8855-4839-BA79-A9A942A3DE88', 'Glam camera, umbrella lighting and printer'],
    ['EA181D68-3FB7-4782-954C-733FA044C585', 'Glam guest capture screen'],
    ['158DA7D0-382F-450C-8A45-AF475673A40B', 'Glam printed photo output']
  ],
  digital: [
    ['CAF13878-2D5E-412B-8D93-1D336697AC2A', 'Digital tablet booth with guest'],
    ['F73ABC7E-837B-4FE0-8DF7-125C213299CE', 'Digital tablet booth'],
    ['8CCF274A-EF6D-4370-ADBA-4D693EBB439F', 'Digital guest capture screen'],
    ['FB24F8FF-5F78-4EC7-BB76-9E4D98629AF1', 'Guest enjoying the Digital booth']
  ],
  '360': [
    ['23E2CBF3-4910-4370-92C2-94CD3345ED1B', 'Guest on the 360 platform'],
    ['BD5DF94B-4FD3-4810-900A-4F462557A5B6', '360 platform and rotating camera arm'],
    ['F2E35D9A-D85B-46F6-9787-7B9C6F2FBDC9', '360 guest experience']
  ]
};
export function proposalPhotoKey(name='') {
  const key=String(name).toLowerCase();
  if(key.includes('360'))return '360';
  if(key.includes('digital'))return 'digital';
  if(key.includes('glam'))return 'glam';
  return null;
}
export const photoSectionTitle = name => `${name} · Experience photos`;
export function mappedProposalPhotos(experiences,assets,createId) {
  return experiences.flatMap(experience=>{
    const mapping=proposalPhotoMapping[proposalPhotoKey(experience.name)];
    if(!mapping)return [];
    const matches=mapping.map(([prefix])=>assets.find(asset=>asset.filename?.startsWith(prefix)));
    // A partial mapping cannot preserve the semantic order of the photo slots.
    if(matches.some(asset=>!asset))return [];
    return [{id:createId(),kind:'EXPERIENCE',title:photoSectionTitle(experience.name),body:`Reference photography for ${experience.name}. Event styling and final creative are confirmed separately.`,media_ids:matches.map(asset=>asset.id)}];
  });
}
export function retainProposalPhotoSections(sections,experiences) {
  const titles=new Set(experiences.map(item=>photoSectionTitle(item.name)));
  return sections.filter(section=>!(section.kind==='EXPERIENCE'&&section.title?.endsWith(' · Experience photos')&&section.body?.startsWith('Reference photography for '))||titles.has(section.title));
}
