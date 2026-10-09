import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingNextAction } from '../shared/booking-lifecycle.js';
const paid = {commercialAccepted:true,total:2448,netPaid:734.40,invoice:{status:'PARTIAL'},contract:{status:'SIGNED'},workspaceInvited:true,resourcesAvailable:true,event:{status:'PENDING_CONTRACT'}};
test('each independent prerequisite prevents premature confirmation or planning',()=>{
  assert.equal(bookingNextAction({...paid,commercialAccepted:false}),'ACCEPT_PROPOSAL');
  assert.equal(bookingNextAction({...paid,invoice:null}),'CREATE_SEND_INVOICE');
  assert.equal(bookingNextAction({...paid,invoice:{status:'DRAFT'}}),'SEND_INVOICE');
  assert.equal(bookingNextAction({...paid,netPaid:734.39}),'PAY_BOOKING_RETAINER_FEE');
  assert.equal(bookingNextAction({...paid,contract:null}),'PREPARE_SEND_AGREEMENT');
  assert.equal(bookingNextAction({...paid,contract:{status:'ISSUED'}}),'SIGN_AGREEMENT');
  assert.equal(bookingNextAction({...paid,contract:{status:'REVOKED'}}),'REVIEW_AGREEMENT');
  assert.equal(bookingNextAction({...paid,workspaceInvited:false}),'SEND_WORKSPACE_INVITATION');
  assert.equal(bookingNextAction({...paid,resourcesAvailable:false}),'REVIEW_RESOURCE_AVAILABILITY');
  assert.equal(bookingNextAction(paid),'CONFIRM_BOOKING');
});
test('signing can invite the workspace while short-notice full-payment confirmation remains blocked',()=>{
  assert.equal(bookingNextAction({...paid,shortNotice:true,workspaceInvited:false}),'SEND_WORKSPACE_INVITATION');
  assert.equal(bookingNextAction({...paid,shortNotice:true}),'PAY_REQUIRED_BALANCE');
  assert.equal(bookingNextAction({...paid,shortNotice:true,netPaid:2448}),'CONFIRM_BOOKING');
  assert.equal(bookingNextAction({...paid,shortNotice:true,requiredPayment:1000,netPaid:1000}),'CONFIRM_BOOKING');
});
test('refunds and invalid financial inputs cannot unlock the lifecycle',()=>{
  assert.equal(bookingNextAction({...paid,netPaid:734.39}),'PAY_BOOKING_RETAINER_FEE');
  for(const total of [0,-1,'bad',Infinity]) assert.equal(bookingNextAction({...paid,total}),'REVIEW_PRICING');
  assert.equal(bookingNextAction({...paid,netPaid:NaN}),'PAY_BOOKING_RETAINER_FEE');
  for(const requiredPayment of [-1,2500,'bad']) assert.equal(bookingNextAction({...paid,requiredPayment}),'REVIEW_PAYMENT_REQUIREMENT');
  assert.equal(bookingNextAction({...paid,invoice:{status:'REFUNDED'}}),'REVIEW_CLOSED_BOOKING');
  assert.equal(bookingNextAction({...paid,event:{status:'CANCELLED'}}),'REVIEW_CLOSED_BOOKING');
});
test('required minimum uses cents and rounds upward rather than accepting less than thirty percent',()=>{
  assert.equal(bookingNextAction({...paid,total:2448.01,netPaid:734.40}),'PAY_BOOKING_RETAINER_FEE');
  assert.equal(bookingNextAction({...paid,total:2448.01,netPaid:734.41}),'CONFIRM_BOOKING');
});
test('planning actions depend on actual confirmation and submitted/approved state',()=>{
  const confirmed={...paid,event:{status:'CONFIRMED'}};
  assert.equal(bookingNextAction(confirmed),'COMPLETE_EVENT_DETAILS');
  assert.equal(bookingNextAction({...confirmed,planningStatus:'SUBMITTED'}),'REVIEW_EVENT_DETAILS');
  assert.equal(bookingNextAction({...confirmed,planningStatus:'APPROVED'}),'PLANNING_APPROVED');
  assert.equal(bookingNextAction({...paid,planningStatus:'SUBMITTED'}),'CONFIRM_BOOKING');
});
