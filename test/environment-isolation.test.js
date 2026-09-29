import test from 'node:test';
import assert from 'node:assert/strict';
import {assertApiBase, assertEnvironmentIsolation, environments, originAllowed} from '../shared/environment-isolation.js';
for (const [environment, expected] of Object.entries(environments)) {
  const other = environments[environment === 'production' ? 'staging' : 'production'];
  const config = {APP_ENV:environment, CLIENT_ORIGIN:expected.admin, PUBLIC_APP_URL:expected.admin, PUBLIC_BASE_URL:expected.website, PUBLIC_DOCUMENT_BASE_URL:expected.website, PUBLIC_INQUIRY_ALLOWED_ORIGINS:expected.origins.join(',')};
  test(`${environment} accepts only its own Admin API build configuration`, () => {
    assert.doesNotThrow(() => assertApiBase(environment, `${expected.api}/api`));
    for(const bad of [undefined,'/api',`${other.api}/api`,'http://localhost:4000/api']) assert.throws(() => assertApiBase(environment, bad));
  });
  test(`${environment} rejects cross-environment form, CMS and document origins`, () => {
    assert.doesNotThrow(() => assertEnvironmentIsolation(config));
    for (const key of ['CLIENT_ORIGIN','PUBLIC_APP_URL','PUBLIC_BASE_URL','PUBLIC_DOCUMENT_BASE_URL']) assert.throws(() => assertEnvironmentIsolation({...config,[key]:other.website}));
    assert.throws(() => assertEnvironmentIsolation({...config,PUBLIC_INQUIRY_ALLOWED_ORIGINS:`${expected.website},${other.website}`}));
    for(const origin of expected.origins) assert.equal(originAllowed(environment,origin),true);
    for(const origin of other.origins) assert.equal(originAllowed(environment,origin),false);
    assert.equal(originAllowed(environment,`https://evil.example`,['https://evil.example']),false);
  });
}
test('development supports explicit local origins without weakening hosted environments', () => {
  assert.doesNotThrow(() => assertEnvironmentIsolation({APP_ENV:'development'}));
  assert.equal(originAllowed('development','http://localhost:5173',['http://localhost:5173']),true);
  assert.equal(originAllowed('production','http://localhost:5173',['http://localhost:5173']),false);
});

const {assertDatabaseIdentity} = await import('../server/src/config/database-identity.js');
test('API and worker refuse a database from another environment before processing work', async () => {
  const db = {query: async () => ({rows:[{system_identifier:'staging-db'}]})};
  await assertDatabaseIdentity(db,{APP_ENV:'staging',EXPECTED_DATABASE_SYSTEM_ID:'staging-db'});
  await assert.rejects(assertDatabaseIdentity(db,{APP_ENV:'production',EXPECTED_DATABASE_SYSTEM_ID:'production-db'}),/mismatch/);
  await assert.rejects(assertDatabaseIdentity(db,{APP_ENV:'production'}),/required/);
});

const {projectPageContent} = await import('../shared/public-cms-projection.js');
test('published CMS slots reach the existing public website contract without mixing payloads', () => {
  const rows = [{content_key:'page.home',body:{title:'LOLA',seo:{description:'Approved'}}}];
  const prod = projectPageContent(rows,[{page_slug:'home',slot_key:'home.001',html:'Production'}],[]);
  const staging = projectPageContent(rows,[{page_slug:'home',slot_key:'home.001',html:'Staging'}],[]);
  assert.equal(prod['page.home'].body.copy['home.001'].html,'Production');
  assert.equal(staging['page.home'].body.copy['home.001'].html,'Staging');
  assert.equal(rows[0].body.copy,undefined);
  assert.equal(projectPageContent(rows,[],[])['page.home'].body.copy,undefined);
});

test('unpublished managed page slots suppress legacy fallback without leaking draft text', () => {
  const rows=[{content_key:'page.home',body:{copy:{'home.001':{html:'Legacy text'}}}}];
  const result=projectPageContent(rows,[],[],[{page_slug:'home',slot_key:'home.001',html:'Private draft',href:'https://draft.invalid'}]);
  assert.deepEqual(result['page.home'].body.copy['home.001'],{html:''});
  assert.equal(rows[0].body.copy['home.001'].html,'Legacy text');
});
