// Fixed normalized coordinates avoid accepting arbitrary SVG, HTML or image data.
export function validDrawnSignature(strokes){
 if(!Array.isArray(strokes)||!strokes.length||strokes.length>80)return false;
 let points=0,hasMovement=false;
 for(const stroke of strokes){
  if(!Array.isArray(stroke)||stroke.length<2||stroke.length>1200)return false;
  points+=stroke.length;if(points>6000)return false;
  for(const point of stroke){if(!Array.isArray(point)||point.length!==2||point.some(value=>!Number.isFinite(value)||value<0||value>1))return false;}
  if(stroke.some(point=>Math.hypot(point[0]-stroke[0][0],point[1]-stroke[0][1])>.01))hasMovement=true;
 }
 return hasMovement;
}
export const DRAWN_CONTRACT_CONSENT='I have reviewed this agreement and agree to its terms. I consent to signing electronically and intend my drawn signature to be my signature.';
