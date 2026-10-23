import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardGreeting} from '../src/utils/dashboard-greeting.js';
const at=(hour,minute=0)=>new Date(2026,9,23,hour,minute);
test('2:31 PM is afternoon in the operator local timezone',()=>assert.equal(dashboardGreeting(at(14,31)),'Good afternoon'));
test('greeting changes at noon and 6 PM and resets at midnight',()=>{
 for(const [hour,minute,expected] of [[0,0,'Good morning'],[11,59,'Good morning'],[12,0,'Good afternoon'],[17,59,'Good afternoon'],[18,0,'Good evening'],[23,59,'Good evening']]) assert.equal(dashboardGreeting(at(hour,minute)),expected);
});
