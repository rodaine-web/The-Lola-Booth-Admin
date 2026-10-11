import {Router} from 'express';
import {query,transaction} from '../db/pool.js';
import {asyncHandler} from '../utils/async-handler.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from '../services/audit-service.js';
import {normalizeAppearance,validAppearance} from '../../../shared/admin-appearance.js';
export const appearanceRouter=Router();
// Mounted after authenticate. No actor ID is accepted from the request body.
appearanceRouter.get('/preferences/appearance',asyncHandler(async(req,res)=>{
 const row=(await query('SELECT admin_appearance FROM users WHERE id=$1',[req.user.id])).rows[0];
 res.set('Cache-Control','private, no-store').json(normalizeAppearance(row?.admin_appearance));
}));
appearanceRouter.patch('/preferences/appearance',asyncHandler(async(req,res)=>{
 if(!validAppearance(req.body))throw new AppError('Choose a view, six-digit background color and supported chart palette.',422,'APPEARANCE_INVALID');
 res.json(await transaction(async()=>{
  await query('UPDATE users SET admin_appearance=$1 WHERE id=$2',[JSON.stringify(req.body),req.user.id]);
  await writeAudit({req,action:'admin_appearance_changed',entity:'user',entityId:req.user.id,after:req.body});
  return req.body;
 }));
}));
