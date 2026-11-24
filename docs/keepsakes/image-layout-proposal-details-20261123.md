# Staging Keepsakes presentation correction

Product examples previously stretched 118×91 mockup crops into large previews.
The 12 shared examples now render at 1000×750 using the existing native product
renderer and the approved sample portrait. Selected guest-photo canvases render
at 2000×1500. Product availability and prices are unchanged.

Collection copy sits below its image instead of overlapping it. Hero artwork
preserves the full product composition. Admin product media uses a dedicated
110px track (85px on mobile), text has a shrinkable track, and retail price
forms span the card below both. The station proposal configurator uses the
same layout and renderer.

Catalogue-priced quotation rows previously dropped detail text when mapping
from the immutable pricing quote. Every newly built proposal row now retains
supplied details or derives a description from the actual package, entitlement,
add-on or service type. Rental descriptions include the selected package and
print allowance. Prices, agreed totals and accepted snapshots are unchanged.

Validation: 829 tracked regression tests passed, 58 environment-specific skips;
real disposable PostgreSQL catalogue/proposal and lookup/station checks passed;
shop 1440/768/390/320 and Admin catalogue plus station configurator 1440/390
passed explicit media/text/form non-overlap checks. Vite build passed.
