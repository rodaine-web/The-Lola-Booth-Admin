import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {environmentCors} from '../server/src/middleware/environment-cors.js';
import {galleryOrigins,environments,assertEnvironmentIsolation} from '../shared/environment-isolation.js';

test('local browser configuration is read per request while hosted origins remain fixed',async()=>{
  let environment='test',origins=['http://localhost:5173'];
  const app=express();app.use(environmentCors(()=>environment,()=>origins));
  app.get('/api/auth/me',(req,res)=>res.json({ok:true}));
  app.use((error,req,res,next)=>res.status(403).end());
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/auth/me`;
    origins=['http://localhost:5174'];
    assert.equal((await fetch(url,{headers:{Origin:origins[0]}})).status,200);
    assert.equal((await fetch(url,{headers:{Origin:'http://localhost:5173'}})).status,403);
    environment='production';
    assert.equal((await fetch(url,{headers:{Origin:origins[0]}})).status,403);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

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
      for (const path of ['/api/gallery/resolve','/api/gallery/media/qa-ticket','/api/keepsakes','/api/keepsakes/access/photo/synthetic','/api/keepsakes/orders/synthetic','/api/keepsakes/artwork/synthetic']) {
        const response=await fetch(base+path,{headers:{Origin:origin}});
        assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);
        assert.equal(response.headers.get('access-control-allow-credentials'),null);
        assert.equal((await fetch(base+path,{headers:{Origin:other}})).status,403);
      }
      const shopPreflight=await fetch(base+'/api/keepsakes/access/photo/synthetic/quote',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
      assert.equal(shopPreflight.status,204);assert.equal(shopPreflight.headers.get('access-control-allow-origin'),origin);assert.equal(shopPreflight.headers.get('access-control-allow-credentials'),null);
      for(const path of ['/api/gallery-admin/albums','/api/keepsakes-admin','/api/keepsakes-admin/products','/api/keepsakes-other','/api/auth/me','/api/integrations/marketplace','/api/gallery-other','/api/public/inquiries'])
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

test('staging shop domain has only public Keepsakes access, including bearer preflight',async()=>{
 const {STAGING_SHOP_ORIGIN}=await import('../shared/keepsakes-host.js');
 const app=express();app.use(environmentCors('staging'));app.use((req,res)=>res.json({ok:true}));app.use((error,req,res,next)=>res.status(403).end());
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/api/keepsakes/catalogue','/api/keepsakes/photos/request','/api/keepsakes/photos/collection','/api/keepsakes/photos/assets/synthetic']){
   const response=await fetch(base+path,{headers:{Origin:STAGING_SHOP_ORIGIN}});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-credentials'),null);
  }
  const preflight=await fetch(base+'/api/keepsakes/photos/collection',{method:'OPTIONS',headers:{Origin:STAGING_SHOP_ORIGIN,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'}});assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers'),/authorization/);
  for(const path of ['/api/auth/me','/api/keepsakes-admin','/api/gallery-admin/albums','/api/gallery','/api/public/inquiries'])assert.equal((await fetch(base+path,{headers:{Origin:STAGING_SHOP_ORIGIN}})).status,403);
  assert.equal((await fetch(base+'/api/keepsakes/catalogue',{headers:{Origin:'https://stagingshop.thelolabooth.com.evil.example'}})).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
