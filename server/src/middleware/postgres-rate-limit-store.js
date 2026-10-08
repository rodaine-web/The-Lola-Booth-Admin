import crypto from 'node:crypto';
import {query} from '../db/pool.js';
import {env} from '../config/env.js';
export class PostgresPublicRateLimitStore {
 localKeys=false;
 prefix='public-writes:';
 init(options){this.windowMs=options.windowMs;}
 hash(key){return crypto.createHmac('sha256',env.jwtSecret).update(this.prefix+key).digest('hex');}
 async increment(key){
  await query('DELETE FROM public_api_rate_limits WHERE reset_at < now()');
  const result=await query(`INSERT INTO public_api_rate_limits(key_hash,hits,reset_at) VALUES($1,1,now()+($2::bigint*interval '1 millisecond'))
    ON CONFLICT(key_hash) DO UPDATE SET hits=CASE WHEN public_api_rate_limits.reset_at<=now() THEN 1 ELSE public_api_rate_limits.hits+1 END,
    reset_at=CASE WHEN public_api_rate_limits.reset_at<=now() THEN excluded.reset_at ELSE public_api_rate_limits.reset_at END
    RETURNING hits,reset_at`,[this.hash(key),this.windowMs]);
  return {totalHits:result.rows[0].hits,resetTime:result.rows[0].reset_at};
 }
 async decrement(key){await query('UPDATE public_api_rate_limits SET hits=greatest(0,hits-1) WHERE key_hash=$1',[this.hash(key)]);}
 async resetKey(key){await query('DELETE FROM public_api_rate_limits WHERE key_hash=$1',[this.hash(key)]);}
}
