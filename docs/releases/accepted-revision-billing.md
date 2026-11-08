# Invoice and agreement totals follow the accepted revision

When Admin revised a sent proposal, its saved version could include both the revised offer at the root and a nested proposal_snapshot of the previous public offer. Invoice and agreement generation preferred that stale nested copy. A client could accept a revised $1,200 offer while both downstream documents used the previous $1,500 amount.

Both generators now resolve the accepted version’s own snapshot. Legacy versions stored only inside a wrapper remain supported; explicit root values, including zero, take precedence. New versions omit the previous published copy. Historical version rows, invoices and signed agreements are not rewritten.

The booking invoice handoff refuses to reuse an existing invoice whose accepted version or total does not match. Unsigned agreement resend/signing also blocks a total mismatch and requests review and replacement. This change does not repair or resend previously incorrect customer documents automatically.

Validation: the real PostgreSQL review/resend/accept journey covers $1,500 → $1,200, correct public offer/accepted version, a $1,200 invoice with revised line items and a $1,200 issued agreement. It also injects historical stale nested data to verify compatibility and tests repeated invoice creation plus mismatch checks. Restoring either old generator independently reproduces the $1,500-versus-$1,200 assertion failure. Shared snapshot unit tests cover root precedence, zero and legacy wrappers. No migration.
