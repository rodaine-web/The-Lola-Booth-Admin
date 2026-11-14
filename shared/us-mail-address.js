const states=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
export function normalizeUsMailAddress(input){
 const source=input||{},address=Object.fromEntries(['name','address_line1','address_line2','address_city','address_state','address_zip','address_country'].map(key=>[key,String(source[key]||'').trim()]));
 address.address_state=address.address_state.toUpperCase();address.address_country=address.address_country.toUpperCase();
 if(!address.name||address.name.length>120||!address.address_line1||address.address_line1.length>200||address.address_line2.length>200||!address.address_city||address.address_city.length>100||!states.has(address.address_state)||!/^\d{5}(-\d{4})?$/.test(address.address_zip)||address.address_country!=='US'||Object.values(address).some(value=>/[\x00-\x1f\x7f]/.test(value)))return null;
 return address;
}
