export const STAGING_SHOP_ORIGIN='https://stagingshop.thelolabooth.com';
export function isStagingShopHost(hostname){return hostname===new URL(STAGING_SHOP_ORIGIN).hostname;}
export function keepsakesPublicOrigin(config){
 if(config.APP_ENV==='staging')return 'https://staginggallery.thelolabooth.com';
 return config.GALLERY_PUBLIC_ORIGIN||config.CLIENT_ORIGIN||'http://localhost:5173';
}

export function lolaOrigins(environment='staging'){const staging=environment!=='production';return {website:staging?'https://staging.thelolabooth.com':'https://thelolabooth.com',gallery:staging?'https://staginggallery.thelolabooth.com':'https://gallery.thelolabooth.com',shop:staging?STAGING_SHOP_ORIGIN:'https://shop.thelolabooth.com'};}
