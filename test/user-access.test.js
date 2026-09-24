import test from 'node:test';
import assert from 'node:assert/strict';
import {assertUserManagement,assertGrantablePermissions} from '../server/src/services/user-access-service.js';
const admin={id:'admin',roles:['ADMIN'],permissions:['edit:users','read:website']};
const superAdmin={id:'super',roles:['SUPER_ADMIN'],permissions:['edit:users','assign:roles']};
test('privilege grants cannot exceed the actor or grant root',()=>{
 assert.doesNotThrow(()=>assertGrantablePermissions(admin,['read:website']));
 assert.throws(()=>assertGrantablePermissions(admin,['write:settings']),e=>e.code==='PRIVILEGE_ESCALATION_BLOCKED');
 assert.throws(()=>assertGrantablePermissions({permissions:['*']},['*']),e=>e.code==='ROOT_PRIVILEGE_BLOCKED');
});
test('account-management hierarchy protects privileged and own accounts',()=>{
 assert.doesNotThrow(()=>assertUserManagement(superAdmin,['ADMIN'],'other'));
 assert.throws(()=>assertUserManagement(superAdmin,['OWNER'],'owner'),e=>e.code==='OWNER_ACCOUNT_PROTECTED');
 assert.throws(()=>assertUserManagement(admin,['SUPER_ADMIN'],'super'),e=>e.code==='ADMIN_ACCOUNT_PROTECTED');
 assert.throws(()=>assertUserManagement(superAdmin,[],'super'),e=>e.code==='SELF_ACCESS_CHANGE_BLOCKED');
 assert.throws(()=>assertUserManagement({roles:['OWNER']},['ROOT'],'root'),e=>e.code==='ROOT_ACCOUNT_PROTECTED');
});
