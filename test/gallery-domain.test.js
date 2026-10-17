import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {environmentCors} from '../server/src/middleware/environment-cors.js';
import {galleryOrigins,environments,assertEnvironmentIsolation} from '../shared/environment-isolation.js';

for (const environment of ['staging','production']) {
  test(`${environment} gallery hostname can access public gallery routes only`,async()=>{
    const app=express();app.use(environmentCors(environment));
    app.use((req,res)=>res.json({ok:true}));
    app.use((error,req,res,next)=>res.status(error.status||error.statusCode||403).json({code:error.code}));
    const server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    try {
      const base=`http://127.0.0.1:${server.address().port}`;
      const origin=galleryOrigins[environment];
      const other=galleryOrigins[environment==='staging'?'production':'staging'];
      const preflight=await fetch(base+'/api/gallery/resolve',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
      assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
      assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
      for (const path of ['/api/gallery/resolve','/api/gallery/media/qa-ticket']) {
        const response=await fetch(base+path,{headers:{Origin:origin}});
        assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);
        assert.equal((await fetch(base+path,{headers:{Origin:other}})).status,403);
      }
      for(const path of ['/api/gallery-admin/albums','/api/auth/me','/api/integrations/marketplace','/api/gallery-other','/api/public/inquiries'])
        assert.equal((await fetch(base+path,{headers:{Origin:origin}})).status,403);
      const admin=await fetch(base+'/api/auth/me',{headers:{Origin:environments[environment].admin}});
      assert.equal(admin.status,200);assert.equal(admin.headers.get('access-control-allow-credentials'),'true');
      assert.equal((await fetch(base+'/api/gallery/resolve',{headers:{Origin:'https://gallery.thelolabooth.com.evil.example'}})).status,403);
    } finally {await new Promise(resolve=>server.close(resolve));}
  });
  test(`${environment} cannot generate gallery links for the other environment`,()=>{
    const e=environments[environment];const config={APP_ENV:environment,CLIENT_ORIGIN:e.admin,PUBLIC_APP_URL:e.admin,PUBLIC_BASE_URL:e.website,PUBLIC_DOCUMENT_BASE_URL:e.website,PUBLIC_INQUIRY_ALLOWED_ORIGINS:e.website};
    assert.doesNotThrow(()=>assertEnvironmentIsolation({...config,GALLERY_PUBLIC_ORIGIN:galleryOrigins[environment]}));
    assert.throws(()=>assertEnvironmentIsolation({...config,GALLERY_PUBLIC_ORIGIN:galleryOrigins[environment==='staging'?'production':'staging']}),/Gallery origin/);
  });
}
