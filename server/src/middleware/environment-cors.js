import cors from 'cors';
import {originAllowed,galleryOriginAllowed} from '../../../shared/environment-isolation.js';
import {AppError} from '../utils/errors.js';

export function environmentCors(environment, fallbackOrigins=[]) {
  return cors((req,callback)=>{
    const origin=req.headers.origin;
    const currentEnvironment=typeof environment==='function'?environment():environment;
    const currentOrigins=typeof fallbackOrigins==='function'?fallbackOrigins():fallbackOrigins;
    const publicGallery=galleryOriginAllowed(currentEnvironment,origin,req.path);
    if (!publicGallery && !originAllowed(currentEnvironment,origin,currentOrigins))
      return callback(new AppError('Requests are not allowed from this origin.',403,'CORS_REJECTED'));
    callback(null,{origin:true,credentials:!publicGallery});
  });
}
