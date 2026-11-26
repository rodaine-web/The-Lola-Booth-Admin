import {PRODUCT_IMAGE_IDS,productMarketingImage} from './keepsakes-product-assets.js';
// One commercial catalogue shared by storefront, Admin and proposal configuration.
// Provider names describe intended routes; they never assert integration readiness.
export const KEEPSAKES_COLLECTIONS = Object.freeze([
 {id:'digital',title:'Digital Keepsakes',description:'Professionally edited digital photos and strips, made from your Lola Booth moments.'},
 {id:'everyday',title:'Everyday Keepsakes',description:'Personal keepsakes for daily enjoyment, sharing and gifting.'},
 {id:'signature',title:'Premium Keepsakes',description:'Elevated statement pieces that turn your memories into lasting treasures.'},
]);
// Owner-supplied design examples, never supplier verification or a guest's photograph.
export const KEEPSAKES_PRODUCT_EXAMPLES=PRODUCT_IMAGE_IDS;
export const keepsakesExample=(key,index=0)=>productMarketingImage(key,index)?.src||null;
const entries=[
 ['edited-photo','Unbranded Photos from Our DSLR Camera','digital','DIGITAL_EDIT','Your selected Lola Booth photograph will be professionally enhanced and delivered without the event frame, overlay, or branding.','ORIGINAL_UNBRANDED'],
 ['edited-strip','Branded Photo Strips from Our Photo Booth','digital','DIGITAL_EDIT','Your selected branded photo strip will be professionally enhanced and delivered as a digital download.','BRANDED_STRIP'],
 ['edited-package','Digital Package','digital','DIGITAL_EDIT','One edited unbranded photo and one edited branded strip, together.','PHOTO_AND_STRIP'],
 ['keychain','Photo Keychain','everyday','IN_HOUSE','Your favorite photo in a beautifully finished keepsake keychain.','SINGLE_PHOTO'],
 ['magnet','Photo Magnet','everyday','IN_HOUSE','A little memory to enjoy every day, printed and assembled with care.','SINGLE_PHOTO'],
 ['acrylic-display','Simple Acrylic Block','everyday','IN_HOUSE','A photograph inserted between clear acrylic panels.','SINGLE_PHOTO'],
 ['jacketed-print','Photo in a Jacket','everyday','IN_HOUSE','Your photograph, beautifully printed and presented in a photo jacket.','SINGLE_PHOTO'],
 ['framed-photo','Framed Photos','everyday','IN_HOUSE','A favorite moment printed and placed in a carefully selected frame.','SINGLE_PHOTO'],
 ['postcard','Postcards','everyday','LOB','Send a postcard home or to your loved ones.','SINGLE_PHOTO'],
 ['premium-acrylic','Premium Acrylic Block (UV Printing)','signature','WHCC','Your photograph printed directly onto acrylic using UV printing.','SINGLE_PHOTO'],
 ['photo-book','Photo Books & Albums','signature','GELATO_OR_WHCC','A beautifully bound collection of your authorized Lola Booth photographs.','MULTI_PHOTO'],
 ['metal-print','Metal Photo Prints','signature','WHCC','Your photograph on metal, with a radiant contemporary finish.','SINGLE_PHOTO'],
];
const displayOrder=['edited-strip','edited-photo','edited-package','postcard','keychain','magnet','jacketed-print','framed-photo','acrylic-display','metal-print','premium-acrylic','photo-book'];
export const KEEPSAKES_CORE_PRODUCTS=Object.freeze([...entries].sort((a,b)=>displayOrder.indexOf(a[0])-displayOrder.indexOf(b[0])).map(([key,title,collection,route,description,source])=>Object.freeze({key,title,collection,route,description,source,retailEligible:true,stationEligible:collection==='everyday',complimentaryEligible:['keychain','magnet'].includes(key),mandatoryPaidEligible:['keychain','magnet'].includes(key),image:keepsakesExample(key)||`/assets/keepsakes/approved/${key}.webp`})));
export const keepsakesCoreProduct=key=>KEEPSAKES_CORE_PRODUCTS.find(p=>p.key===key);
export function coreCatalogueView(rows=[]){
 const byKey=new Map(rows.map(row=>[row.catalogue_key,row]));
 return KEEPSAKES_CORE_PRODUCTS.map(p=>{const row=byKey.get(p.key);return {...p,productId:row?.id||null,retailCents:row?.retail_cents??null,currency:'USD',available:!!(row?.active&&row?.verified&&row?.retail_cents&&row?.variants?.length&&['DIGITAL_EDIT','IN_HOUSE','LOB'].includes(p.route)),variants:row?.variants||[]};});
}
