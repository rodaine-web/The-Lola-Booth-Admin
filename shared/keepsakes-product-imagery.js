export function partnerProductImage(variant){
 if(variant?.sku==='GLOBAL-MUG-W')return {url:'/assets/keepsakes/prodigi-white-mug-11oz.png',label:'Prodigi white 11oz mug'};
 if(variant?.sku==='GLOBAL-CFP-12X16'&&variant.attributes?.color==='black')return {url:'/assets/keepsakes/prodigi-classic-frame-black.png',label:'Prodigi classic black frame reference'};
 if(variant?.sku==='GLOBAL-PHO-4X6'&&variant.attributes?.finish==='gloss')return {url:'/assets/keepsakes/prodigi-c-type-gloss.jpg',label:'Prodigi gloss paper finish reference'};
 return null;
}
