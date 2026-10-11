import test from 'node:test';
import assert from 'node:assert/strict';
import {requiredCreativeComponents,creativeCoverage} from '../shared/event-planning.js';

test('each selected experience requires its own creative approval coverage',()=>{
 const required=requiredCreativeComponents([{id:'glam-1',name:'LOLA Glam'},{id:'glam-2',name:'Classic Photo'},{id:'360',name:'LOLA 360'}],true);
 const proofs=[{status:'APPROVED',version:2,approved_version:2,metadata:{components:[{experienceId:'glam-1',component:'overlay'}]}}];
 const coverage=creativeCoverage(required,proofs);
 assert.equal(coverage.filter(x=>x.complete).length,1);
 assert.equal(coverage.find(x=>x.experienceId==='glam-2'&&x.component==='overlay').complete,false);
 assert.ok(required.some(x=>x.experienceId==='360'&&x.component==='intro_outro'));
 assert.ok(required.some(x=>x.experienceId==='glam-1'&&x.component==='print_design'));
});
test('prior approved versions, unsent drafts and unscoped generic proofs cannot mark creative ready',()=>{
 const required=requiredCreativeComponents([{id:'glam',name:'Glam'}]);
 const component={experienceId:'glam',component:'overlay'};
 for(const proof of [
  {status:'APPROVED',version:3,approved_version:2,metadata:{components:[component]}},
  {status:'DRAFT',version:1,approved_version:1,metadata:{components:[component]}},
  {status:'APPROVED',version:1,approved_version:1,metadata:{}},
  {status:'APPROVED',version:1,approved_version:1,deleted_at:'2030-01-01',metadata:{components:[component]}}
 ])assert.equal(creativeCoverage(required,[proof]).some(x=>x.complete),false);
});
