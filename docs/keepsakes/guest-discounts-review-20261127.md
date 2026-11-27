# Staging guest checkout summary and discount codes

The shop now moves from cart/contact details to `/shop/review` before creating a Stripe Checkout session. The summary includes selected photos, choices, quantities, mailing/contact details, delivery service, tax and total. Customers can edit their cart, apply or remove a code, review the print proof and continue explicitly to Stripe. A missing or stale summary returns the guest to the cart; it cannot start checkout. Digital-only orders keep email-only checkout; their applicable tax is finalized by Stripe.

Keepsakes Admin → Discounts creates percentage or fixed-USD merchandise codes with an optional minimum subtotal and expiry. Codes are normalized, audited, permission-checked and can be disabled. They are Keepsakes codes, separate from Stripe promotion codes, and have unlimited uses until disabled or expired. Shipping is not discounted. At least $0.50 of merchandise must remain, so this version does not create free checkouts. No default public promotion code is provisioned.

The server applies the discount before tax, allocates exact cents to purchased units and revalidates the saved code configuration before creating payment. Stripe receives the already discounted total; it cannot apply another code to an amount that already includes tax. Digital automatic-tax payment webhooks verify the discounted subtotal and final taxed total. Original list prices stay in the purchased snapshot. Partial refunds and tax reversals use the exact discounted amounts paid, including rounding remainders; no zero-dollar Stripe refund is submitted for a fully discounted unit. Orders, Admin totals and transactional emails show the discount.

Verification covers invalid/expired/disabled/minimum codes, changed configuration before checkout, discounted physical tax inputs, discounted digital webhook mismatch rejection, exact 667/666/666-cent selected-unit refunds, and guest apply/remove/payment on desktop/mobile. No real payment or customer email was used.

Reference: [Stripe tax and discounts](https://docs.stripe.com/tax/calculating#discounts-and-tax-calculations).
