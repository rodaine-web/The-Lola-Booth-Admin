import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('public/staging-site/app.js','utf8');
const assetFunction=source.slice(source.indexOf('  const apiAsset='),source.indexOf('  const money='));
function resolve(path,pathname='/experiences'){
  return vm.runInNewContext(assetFunction+'\napiAsset(path)',{
    path,URL,API_BASE:'https://stagingapi.thelolabooth.com',innerWidth:1061,
    location:{origin:'https://staging.thelolabooth.com',pathname}
  });
}

test('hosted website resolves every CMS experience fallback to its served asset',()=>{
  const manifest=JSON.parse(fs.readFileSync('server/import-data/staging-website.json','utf8'));
  for(const row of manifest.records.filter(r=>r.cms_type==='experiences')){
    const fallback=row.payload.fallback_image;
    if(!fallback)continue;
    const hosted=resolve(fallback);
    assert.ok(hosted.startsWith('/assets/'));
    assert.ok(fs.existsSync('public/staging-site'+hosted),hosted);
  }
});
test('embedded preview keeps bundled paths and other media URLs retain their contract',()=>{
  assert.equal(resolve('/staging-site/assets/glam.webp','/staging-site/experiences.html'),'/staging-site/assets/glam.webp');
  assert.equal(resolve('/api/public/staging/media/example'),'https://stagingapi.thelolabooth.com/api/public/staging/media/example');
  assert.equal(resolve('https://example.com/photo.jpg'),'https://example.com/photo.jpg');
  assert.equal(resolve(null),null);
});
