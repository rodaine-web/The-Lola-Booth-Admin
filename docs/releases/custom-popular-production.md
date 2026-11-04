# Restore Custom packages and Most Popular — production candidate

The versioned website renderer dropped the fourth Custom card when replacing the legacy package grids. It also lost the published `most_popular` field at the public API projection.

The renderer now retains each experience's approved Custom card, uses its current custom-production package for the request link, and renders Most Popular styling only for packages marked popular in the published catalog. Standard and professional catalogs show their three priced tiers plus Custom; activation shows its two priced tiers plus Custom. No extra package records or fabricated prices are created.

Custom links open the booking form with the correct experience and quote-only package selected. The live estimate shows “Custom quote required,” rather than presenting a zero subtotal as a free package. Custom pricing still requires reviewed scope, a positive approved price and travel review.

Production uses its own package, experience and add-on IDs. Deployment tooling has an explicit production-only preparation function guarded by database identity; the existing HTTP setup route remains staging-only. Preparation preserves the production public catalog baseline, and publication produces an immutable production snapshot before the pricing flag is enabled.

Validation: the existing pricing DB/browser regression now checks public Most Popular projection, all four Custom cards across desktop/mobile, the Custom request link, and the absence of a free Custom subtotal. Full local regression and build passed. Exact-revision CI and staging/production deployment evidence are recorded in the owner release report.

The user explicitly requested the production rollout. No customer records or staging fixtures are copied to production, no customer messages or charges are part of verification, and historical proposal/invoice snapshots remain protected. Rollback retains additive schema and published quote records; turn off the production pricing flag to restore the preserved legacy public baseline, then coordinate API, worker, Admin and website code if necessary.
