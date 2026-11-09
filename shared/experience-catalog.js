// Primary website order is separate from the standalone Audio Guest Book rental.
export const primaryExperienceKeys = ['glam', '360', 'mirror', 'vogue'];
export const experienceNames = {glam:'The Lola Glam', '360':'The Lola 360', mirror:'The Lola Magic Mirror', vogue:'The Lola Vogue', audio:'Audio Guest Book'};
export const printableExperiences = ['glam', 'mirror', 'vogue'];
export const celebrationPrices = {glam:[599,899,1499], '360':[699,1099,1799], mirror:[799,1199,1999], vogue:[899,1399,2299]};
export function celebrationFeatures(key,index) {
 const hours = '{hours} hours of service';
 const printing = 'On-site printing: {prints} physical prints included';
 const all = {
  glam:[hours,'Professional DSLR photography','Unlimited photo sessions','Digital photos, GIFs & Boomerangs','Instant digital sharing (QR, text, email)','Custom photo overlay','Personalized welcome screen',index?'Premium backdrop selection':'Standard backdrop','Digital props','Online photo gallery','On-site attendant',...(index?[printing,'Event branding']:[]),...(index===2?['Priority customization']:[]),'Setup and breakdown'],
  mirror:[hours,'Full-length interactive mirror','Unlimited photo sessions',['Standard','Enhanced','Premium'][index]+' touchscreen animations','Instant digital sharing (QR, text, email)','Custom photo template','Personalized welcome screen',index?'Premium backdrop selection':'Standard backdrop','Online photo gallery','On-site attendant',...(index?[printing,'Custom mirror animations','Event branding']:[]),...(index===2?['Premium props','Priority gallery delivery']:[]),'Setup and breakdown'],
  '360':[hours,'360° video capture','Unlimited video sessions','Slow-motion video effects','Instant digital sharing (QR, text, email)','Custom video overlay','Professional lighting','On-site attendant',...(index?['Enhanced video effects','Custom event branding','Curated music']:[]),...(index===2?['Premium cinematic effects','Red-carpet-style setup']:[]),'Setup and breakdown'],
  vogue:[hours,'Illuminated Vogue-style enclosure','Unlimited photo sessions','Editorial-style photography',index?'Fully customized magazine cover wording':'Basic magazine cover wording','Professional lighting','Instant digital sharing (QR, text, email)','Online photo gallery','On-site attendant',...(index?['Custom event branding','Enhanced magazine cover design']:[]),...(index===2?[printing,'Red-carpet setup','Premium styling']:[]),'Setup and breakdown']
 };
 return all[key];
}
export const customExperienceFeatures = ['Flexible rental duration','Multiple experiences available','Custom branding and overlays available','Bespoke backdrops available','Additional printing available where supported','Extended or multi-day rentals available','Specialized event setups available','Corporate and brand activations available','Premium styling and props available','Custom enhancements available'];
