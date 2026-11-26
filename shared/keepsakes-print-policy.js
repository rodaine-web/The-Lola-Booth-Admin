// Owner-specified insert sizes. No source photo is overwritten.
export const INSERT_PRINTS=Object.freeze({
 keychain:Object.freeze({dimensions:'2 × 2 in',printSpec:Object.freeze({widthPx:600,heightPx:600,dpi:300,bleedPx:0,safePx:0})}),
 magnet:Object.freeze({dimensions:'2 × 3 in',printSpec:Object.freeze({widthPx:600,heightPx:900,dpi:300,bleedPx:0,safePx:0})})
});
export function sizedInsertVariant(product,variant){const preset=INSERT_PRINTS[product?.key||product?.catalogue_key];return preset&&variant&&!variant.printSpec?{...variant,dimensions:preset.dimensions,printSpec:{...preset.printSpec}}:variant;}
export const PRINT_REVIEW_VERSION='fit-and-crop-20261126-v1';
export const PRINT_REVIEW_STATEMENT='I have reviewed the print size, crop, zoom, image quality and recipient details. I approve this layout for printing and accept responsibility for the crop and image quality I selected.';
