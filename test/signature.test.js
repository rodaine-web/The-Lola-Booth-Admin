import test from 'node:test';
import assert from 'node:assert/strict';
import {validDrawnSignature} from '../shared/signature.js';
test('drawn signatures require bounded, finite strokes with visible movement',()=>{
 assert.equal(validDrawnSignature([[[.1,.2],[.3,.5]]]),true);
 for(const value of [null,[],[[[.1,.2]]],[[[.1,.2],[.1,.2]]],[[[0,0],[Infinity,1]]],[[[0,0],[2,1]]],[[[0,0,1],[1,1]]],Array.from({length:81},()=>[[0,0],[1,1]])])assert.equal(validDrawnSignature(value),false);
 assert.equal(validDrawnSignature(Array.from({length:6},()=>Array.from({length:1200},(_,i)=>[i/1200,.5]))),false);
});
