// Preview geometry is expressed in the 1254px approved source coordinate system.
// These placement guides are visualizations, never supplier print specifications.
export const PREVIEW_TEMPLATE_VERSION='approved-20261125-v1';
const template=(assetId,ratio,quads,extra={})=>({assetId,physicalAspectRatio:ratio,quads,orientation:ratio>1?'LANDSCAPE':'PORTRAIT',cropRules:['contain','cover'],version:PREVIEW_TEMPLATE_VERSION,...extra});
export const KEEPSAKES_PREVIEW_TEMPLATES=Object.freeze({
 'keychain-mono':template('keychain-mono',.73,[[[403,504],[840,504],[837,1098],[403,1097]]],{material:'CLEAR_ACRYLIC',edge:5}),
 'keychain-color':template('keychain-color',.7,[[[406,498],[864,498],[862,1097],[407,1097]]],{material:'CLEAR_ACRYLIC',edge:5}),
 'magnet-mono':template('magnet-mono',1,[[[286,301],[941,301],[938,946],[287,945]]],{material:'CLEAR_INSERT',rounded:true}),
 'magnet-color':template('magnet-color',.68,[[[340,229],[869,230],[870,1011],[340,1012]]],{material:'CLEAR_INSERT',rounded:true}),
 'photo-jacket':template('photo-jacket',.73,[[[707,330],[1113,316],[1114,893],[707,897]]],{material:'PAPER',cornerTabs:.075}),
 'acrylic-insert':template('acrylic-insert',1,[[[349,386],[943,341],[944,908],[349,957]]],{material:'CLEAR_INSERT'}),
 'acrylic-insert-alternate':template('acrylic-insert-alternate',1,[[[416,440],[854,428],[854,861],[416,870]]],{material:'CLEAR_INSERT'}),
 'uv-acrylic-mono':template('uv-acrylic-mono',.84,[[[326,385],[948,313],[945,977],[330,1060]]],{material:'UV_SOLID_ACRYLIC'}),
 'uv-acrylic-color':template('uv-acrylic-color',.84,[[[304,283],[895,299],[896,1004],[305,989]]],{material:'UV_SOLID_ACRYLIC'}),
 'frame-champagne':template('frame-champagne',.38,[[[495,252],[768,252],[768,959],[495,959]]],{material:'FRAMED_PAPER'}),
 'frame-ivory':template('frame-ivory',.46,[[[462,330],[758,331],[758,965],[462,965]]],{material:'FRAMED_PAPER'}),
 'frame-silver':template('frame-silver',.48,[[[456,258],[788,260],[788,955],[456,953]]],{material:'FRAMED_PAPER'}),
 'frame-antique-gold':template('frame-antique-gold',.48,[[[467,248],[784,250],[784,925],[467,924]]],{material:'FRAMED_PAPER'}),
 'frame-metal':template('frame-metal',.72,[[[329,149],[989,143],[1014,1105],[335,1116]]],{material:'METAL_PANEL'}),
 'postcard-lifestyle':template('postcard-lifestyle',1.65,[[[118,495],[938,572],[898,1046],[60,989]]],{material:'PAPER',marketingOnlyBack:true}),
 'guest-photo-book':template('guest-photo-book',1.5,[
  [[284,696],[533,728],[520,840],[271,809]],[[273,819],[520,851],[506,966],[258,931]],[[259,941],[506,977],[491,1089],[246,1055]],
  [[663,724],[1031,675],[1057,798],[681,852]],[[683,864],[1059,810],[1085,934],[701,990]],[[703,1002],[1087,948],[1114,1071],[721,1128]]
 ],{material:'BOOK_PAPER',multiple:true}),
 'premium-album':template('premium-album',1,[
  [[44,644],[459,683],[483,1070],[25,1032]],[[622,718],[841,742],[835,906],[613,881]],[[856,745],[1082,769],[1083,937],[850,909]],[[614,896],[836,923],[829,1092],[606,1066]],[[849,926],[1081,953],[1082,1125],[840,1100]]
 ],{material:'ALBUM_PAPER',multiple:true,clientOnly:true})
});
export function previewTemplateFor(productKey,{assetId,variant}={}){
 const defaults={'metal-print':'frame-metal',keychain:'keychain-mono',magnet:'magnet-mono','jacketed-print':'photo-jacket','acrylic-display':'acrylic-insert','premium-acrylic':'uv-acrylic-mono','framed-photo':'frame-champagne',postcard:'postcard-lifestyle','photo-book':'guest-photo-book'};
 return KEEPSAKES_PREVIEW_TEMPLATES[assetId||variant?.previewAssetId||defaults[productKey]]||null;
}
