import fs from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {approvedKeepsakeAsset} from '../../../shared/keepsakes-product-assets.js';
import {previewTemplateFor} from '../../../shared/keepsakes-preview-templates.js';
import {drawPersonalizedSurface} from '../../../src/utils/product-perspective.js';
import {drawPrintLayout} from '../../../src/utils/keepsakes-preview.js';
export async function savedProductPreview(item,bytes){
 const template=item.previewTemplate||previewTemplateFor(item.product.key,{variant:item.variant});if(!template||!bytes)return null;
 const background=approvedKeepsakeAsset(template.assetId),canvas=createCanvas(1254,1254),ctx=canvas.getContext('2d'),photo=await loadImage(bytes);
 ctx.drawImage(await loadImage(await fs.readFile(new URL('../../../public'+background.srcSet.split(',').at(-1).trim().split(' ')[0],import.meta.url))),0,0,1254,1254);
 const texture=(image,spec,crop)=>{const result=createCanvas(Math.round(spec.widthPx),Math.round(spec.heightPx));drawPrintLayout(result.getContext('2d'),image,spec,crop);return result;};
 template.quads.forEach(quad=>drawPersonalizedSurface(ctx,photo,quad,template,item.customization,texture));return canvas.toBuffer('image/jpeg');
}
