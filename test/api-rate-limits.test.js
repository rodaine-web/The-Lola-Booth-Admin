import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createApiRateLimits} from '../server/src/middleware/api-rate-limits.js';
function request(handler,path,method='GET'){
 return new Promise((resolve,reject)=>{
  const req={path,method,ip:'127.0.0.1',headers:{},socket:{remoteAddress:'127.0.0.1'},app:{get:()=>false}};
  const res=new EventEmitter();const headers={};res.setHeader=(k,v)=>{headers[k]=v;};res.getHeader=k=>headers[k];res.status=code=>{res.statusCode=code;return res;};res.send=body=>resolve({status:res.statusCode,body});
  handler(req,res,error=>error?reject(error):resolve({status:200}));
 });
}
test('navigation and health requests cannot exhaust booking/login quotas; writes remain bounded',async()=>{
 const handler=createApiRateLimits({windowMs:900000,limit:2});
 for(let i=0;i<8;i++)assert.equal((await request(handler,'/api/notifications')).status,200);
 assert.equal((await request(handler,'/api/public/staging/inquiries','POST')).status,200);
 assert.equal((await request(handler,'/api/proposals','POST')).status,200);
 assert.equal((await request(handler,'/api/public/staging/inquiries','POST')).status,429);
 assert.equal((await request(handler,'/api/auth/login','POST')).status,200);
 assert.equal((await request(handler,'/api/health')).status,200);
 assert.equal((await request(handler,'/api/auth/me')).status,200);
});
