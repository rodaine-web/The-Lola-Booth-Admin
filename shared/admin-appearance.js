export const DEFAULT_APPEARANCE = Object.freeze({mode:'DAY',background:'#faf8f4',palette:'LOLA'});
export const APPEARANCE_PALETTES = Object.freeze({
 LOLA:['#a58342','#c5a66c','#dbc59b','#688c80','#8ab6c3','#81749b'],
 OCEAN:['#146c94','#19a7ce','#6ab5a4','#9381bf','#d19c4a','#638269'],
 JEWEL:['#7656a6','#267b83','#b55a79','#aa7a30','#4d8363','#456f9c'],
 ACCESSIBLE:['#0072b2','#e69f00','#009e73','#cc79a7','#d55e00','#56b4e9']
});
export function validAppearance(input){return Boolean(input && Object.keys(input).every(key=>['mode','background','palette'].includes(key)) && ['DAY','NIGHT','AUTO'].includes(input.mode) && /^#[a-fA-F0-9]{6}$/.test(input.background||'') && Object.hasOwn(APPEARANCE_PALETTES,input.palette));}
export function normalizeAppearance(input){return validAppearance(input)?{...input}: {...DEFAULT_APPEARANCE};}
export function appearanceMode(mode,deviceDark){return mode==='AUTO'?(deviceDark?'NIGHT':'DAY'):mode;}
export const chartColours=Array.from({length:6},(_,i)=>`var(--chart-${i}, ${APPEARANCE_PALETTES.LOLA[i]})`);
