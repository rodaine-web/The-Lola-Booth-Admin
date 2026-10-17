import cors from 'cors';
import {originAllowed,galleryOriginAllowed} from '../../../shared/environment-isolation.js';
import {AppError} from '../utils/errors.js';

export function environmentCors(environment, fallbackOrigins=[]) {
  return cors((req,callback)=>{
    const origin=req.headers.origin;
    const publicGallery=galleryOriginAllowed(environment,origin,req.path);
    if (!publicGallery && !originAllowed(environment,origin,fallbackOrigins))
      return callback(new AppError('Requests are not allowed from this origin.',403,'CORS_REJECTED'));
    callback(null,{origin:true,credentials:!publicGallery});
  });
}
