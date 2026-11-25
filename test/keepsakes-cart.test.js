import test from 'node:test';
import assert from 'node:assert/strict';
import {keepsakesCartKey,restoreKeepsakesCart,saveKeepsakesCart} from '../src/utils/keepsakes-cart.js';
const storage=()=>{const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};
test('session cart retains four postcard recipients and leading ZIP zeros only for its own photo capability',()=>{
 const s=storage(),key=keepsakesCartKey('photo','guest-a'),value={cart:[{productId:'card',variantId:'4x6',assetIds:['a'],quantity:1,postcardArtworkColor:'#703040',recipients:Array.from({length:4},(_,i)=>({name:`QA ${i}`,zip:'02134',message:`Note ${i}`}))}],email:'qa@example.invalid',shippingAddress:{zip:'02134'}};
 saveKeepsakesCart(s,key,value,1000);
 assert.deepEqual(restoreKeepsakesCart(s,key,2000),value);
 assert.deepEqual(restoreKeepsakesCart(s,keepsakesCartKey('photo','guest-b'),2000),{});
 assert.deepEqual(restoreKeepsakesCart(s,key,2*60*60*1000+1001),{});assert.equal(s.getItem(key),null);
});
test('cart storage rejects malformed and oversized carts, and restricted storage does not break shopping',()=>{
 const s=storage();s.setItem('k','bad JSON');assert.deepEqual(restoreKeepsakesCart(s,'k'),{});
 saveKeepsakesCart(s,'k',{cart:[{productId:'p',variantId:'v',assetIds:['a'],quantity:999}]},1000);assert.deepEqual(restoreKeepsakesCart(s,'k',2000),{});
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
 assert.deepEqual(restoreKeepsakesCart(blocked,'k'),{});assert.doesNotThrow(()=>saveKeepsakesCart(blocked,'k',{}));
});
