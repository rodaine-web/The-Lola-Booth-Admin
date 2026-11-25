import {pool,query} from '../db/pool.js';
// Session lock protects committed supplier reservations across network calls;
// transaction locks in payment/refund handlers conflict with the same key.
export async function withKeepsakesOrderLock(id,work){
 const client=await pool.connect();
 try{await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[`keepsakes:${id}`]);return await work();}
 finally{try{await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[`keepsakes:${id}`]);}finally{client.release();}}
}
export const lockKeepsakesOrder=id=>query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`keepsakes:${id}`]);
