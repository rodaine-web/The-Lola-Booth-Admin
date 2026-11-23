export const STAGING_SHOP_ORIGIN='https://stagingshop.thelolabooth.com';
export function isStagingShopHost(hostname){return hostname===new URL(STAGING_SHOP_ORIGIN).hostname;}
export function keepsakesPublicOrigin(config){
 if(config.APP_ENV==='staging')return STAGING_SHOP_ORIGIN;
 return config.GALLERY_PUBLIC_ORIGIN||config.CLIENT_ORIGIN||'http://localhost:5173';
}
