# LOLA Support Runbook

## Client Didn't Receive Proposal

1. Check proposal status and recipient email.
2. Check Communications for send record and provider message ID.
3. If email provider is degraded, send the public proposal link manually.
4. Verify the public link opens before resending.

## Payment Succeeded But Invoice Not Updated

1. Check payment provider dashboard for the event.
2. Check webhook events and payment attempts.
3. Do not manually mark paid until provider amount, currency, and invoice match.
4. If webhook was delayed, wait or replay safely from provider dashboard if supported.

## Attendant Cannot Scan

1. Confirm camera permission.
2. Try the phone camera app.
3. Use manual asset UID entry.
4. Confirm the user is assigned to the event or has manager permission.

## Email Down

1. Open System Health.
2. Confirm provider credentials and domain status.
3. Use manual email outside LOLA for urgent client communication.
4. Retry safe failed jobs after provider recovery.

## Worker Stale

1. Restart the worker process.
2. Confirm System Health shows a fresh heartbeat.
3. Inspect failed jobs.
4. Retry failed jobs only when the underlying provider/config issue is resolved.

## Gallery Link Unavailable

1. Confirm the delivery token is active and not expired.
2. Confirm gallery URL/item exists.
3. Revoke and recreate delivery if the wrong link was sent.
4. Send updated link to client.
