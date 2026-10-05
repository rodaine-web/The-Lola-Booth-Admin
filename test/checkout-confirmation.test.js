import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutConfirmation } from '../server/src/services/checkout-confirmation.js';

const invoice = {status:'PARTIALLY_PAID',amount_outstanding:769.30,payments:[{id:'deposit',provider:'STRIPE',provider_session_id:'cs_test_deposit',status:'SUCCEEDED',amount:'329.70'}]};
test('a verified deposit confirms despite an outstanding invoice balance',()=>{
  assert.deepEqual(checkoutConfirmation(invoice,'cs_test_deposit'),{status:'CONFIRMED',amount:329.70,paymentId:'deposit'});
});
test('an older deposit cannot confirm a different checkout',()=>{
  assert.equal(checkoutConfirmation(invoice,'cs_test_balance').status,'PENDING');
});
test('a legacy return acknowledges recorded payments without claiming checkout verification',()=>{
  assert.equal(checkoutConfirmation(invoice).status,'RECORDED');
});
test('failed and refunded payments do not confirm checkout',()=>{
  for(const status of ['PENDING','FAILED','REFUNDED','PARTIALLY_REFUNDED']) {
    assert.equal(checkoutConfirmation({...invoice,payments:[{...invoice.payments[0],status}]},'cs_test_deposit').status,'PENDING');
  }
});
