// Lob currently reports finished test artwork as "processed" as well as "rendered".
// Only accept a complete proof from the trusted asset origin for this exact postcard.
export function lobProofReady(value,postcardId){
 if(!value||!/^psc_[A-Za-z0-9]+$/.test(value.id||'')||value.metadata?.postcard_id!==postcardId||value.failure_reason||!['processed','rendered'].includes(value.status))return false;
 const asset=(raw,path)=>{try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='lob-assets.com'&&!u.port&&!u.username&&!u.password&&u.pathname===path;}catch{return false;}};
 if(!asset(value.url,`/postcards/${value.id}.pdf`))return false;
 return [1,2].every(n=>value.thumbnails?.some(t=>['small','medium','large'].some(size=>asset(t[size],`/postcards/${value.id}_thumb_${size}_${n}.png`))));
}
