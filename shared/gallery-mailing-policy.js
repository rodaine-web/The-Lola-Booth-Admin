import crypto from 'node:crypto';
export function acceptedMailingAllowance(snapshot){
 const value=snapshot?.content?.postcard_mailing?.quantity;
 return Number.isSafeInteger(value)&&value>=0&&value<=10000?value:0;
}
export function mailingRecipientKey(address,secret){
 const normalize=value=>String(value||'').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,'');
 return crypto.createHmac('sha256',secret).update(JSON.stringify(['name','address_line1','address_line2','address_city','address_state','address_zip','address_country'].map(key=>normalize(address[key])))).digest('hex');
}
export function verifyLobSignature(raw,headers,secret,now=Date.now()){
 const stamp=String(headers['lob-signature-timestamp']||''),signature=String(headers['lob-signature']||'');
 if(!secret||secret==='secret'||!Buffer.isBuffer(raw)||!/^\d{10,13}$/.test(stamp)||!/^[a-f0-9]{64}$/i.test(signature))return false;
 const timestamp=Number(stamp)*(stamp.length===10?1000:1);
 if(Math.abs(now-timestamp)>300000)return false;
 const expected=crypto.createHmac('sha256',secret).update(stamp+'.').update(raw).digest();
 return crypto.timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
