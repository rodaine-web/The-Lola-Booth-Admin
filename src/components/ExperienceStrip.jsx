import { experienceImage } from '../utils/experience-assets.js';

export default function ExperienceStrip({items=[]}) {
  if(!items.length)return null;
  return <section className="panel event-experience-strip"><h2>Our Planned Experiences</h2><div className="experience-strip-items">{items.map((item,index)=><article key={item.id||item.experience_id||index}><img src={item.image_url||item.image||experienceImage(item.name)} alt={item.name||'Selected experience'} loading="lazy"/><strong>{item.name}</strong>{item.description&&<small>{item.description}</small>}</article>)}</div></section>;
}
