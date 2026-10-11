import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_APPEARANCE,APPEARANCE_PALETTES,validAppearance,normalizeAppearance,appearanceMode} from '../shared/admin-appearance.js';
test('appearance accepts only modes, six-digit colors and supported coordinated palettes',()=>{
 assert.equal(validAppearance(DEFAULT_APPEARANCE),true);
 for(const mode of ['DAY','NIGHT','AUTO'])for(const palette of Object.keys(APPEARANCE_PALETTES))assert.equal(validAppearance({...DEFAULT_APPEARANCE,mode,palette}),true);
 for(const background of ['red','url(javascript:x)','#fff','#gggggg',''])assert.equal(validAppearance({...DEFAULT_APPEARANCE,background}),false);
 assert.equal(validAppearance({...DEFAULT_APPEARANCE,user_id:'another-user'}),false);
 assert.equal(validAppearance({...DEFAULT_APPEARANCE,palette:'unknown'}),false);
});
test('auto follows device; explicit day/night override device; invalid legacy settings safely default',()=>{
 assert.equal(appearanceMode('AUTO',true),'NIGHT');assert.equal(appearanceMode('AUTO',false),'DAY');
 assert.equal(appearanceMode('DAY',true),'DAY');assert.equal(appearanceMode('NIGHT',false),'NIGHT');
 assert.deepEqual(normalizeAppearance(null),DEFAULT_APPEARANCE);assert.notEqual(normalizeAppearance(null),DEFAULT_APPEARANCE);
});
