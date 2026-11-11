// Survey headers differ by event. Map exact headers explicitly; never infer
// mailing permission from a sharing method, a photo link or column position.
export const surveyFields = ['name','email','phone','address1','address2','city','state','postalCode','country','filename','sessionId','mailingPreference','consent'];
const states = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const fail = message => { const e = new Error(message); e.code = 'FIESTA_SURVEY_INVALID'; throw e; };

export function surveyTable(csv) {
  if (typeof csv !== 'string' || !csv || new TextEncoder().encode(csv).length > 1024 * 1024) fail('Use a survey CSV up to 1 MB.');
  let row=[], cell='', quoted=false, closed=false;
  const rows=[];
  const field=()=>{ if(cell.length>10000)fail('A survey field is too long.'); row.push(cell); cell=''; closed=false; if(row.length>100)fail('Use at most 100 columns.'); };
  const record=()=>{field();if(row.some(v=>v.trim()))rows.push(row);row=[];if(rows.length>5001)fail('Use at most 5,000 survey responses.');};
  csv=csv.replace(/^\uFEFF/,'');
  for(let i=0;i<csv.length;i++) {
    const c=csv[i];
    if(quoted){if(c==='"'){if(csv[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
    else if(c==='"'){if(cell||closed)fail('Malformed CSV quoting.');quoted=true;}
    else if(c===',')field();
    else if(c==='\n'||c==='\r'){if(c==='\r'&&csv[i+1]==='\n')i++;record();}
    else{if(closed)fail('Malformed CSV quoting.');cell+=c;}
  }
  if(quoted)fail('Unclosed CSV quote.');
  if(cell||row.length||closed)record();
  const headers=rows.shift()?.map(v=>v.trim());
  if(!headers?.length||headers.some(h=>!h||h.length>200)||new Set(headers).size!==headers.length)fail('Survey headers must be nonempty and unique.');
  if(!rows.length||rows.some(r=>r.length!==headers.length))fail('Check the survey rows and column counts.');
  return {headers,rows};
}

export function parseFiestaSurvey(csv, mapping, affirmative = {}) {
  const {headers,rows}=surveyTable(csv);
  if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))fail('Map the survey columns before importing.');
  for(const [field,header] of Object.entries(mapping))if(!surveyFields.includes(field)||typeof header!=='string'||!headers.includes(header))fail('A mapped survey column is unavailable.');
  if(!mapping.filename&&!mapping.sessionId)fail('Map a photo filename or session reference.');
  for(const field of ['mailingPreference','consent']) {
    const values=affirmative[field]||[];
    if(!Array.isArray(values)||values.length>10||values.some(v=>typeof v!=='string'||!v.trim()||v.length>200))fail('Choose explicit affirmative survey answers.');
  }
  const indices=Object.fromEntries(Object.entries(mapping).map(([field,header])=>[field,headers.indexOf(header)]));
  return {headers,records:rows.map((row,index)=>{
    const data=Object.fromEntries(surveyFields.map(field=>[field,indices[field]===undefined?'':row[indices[field]].trim()]));
    const issues=[];
    const country=data.country.toUpperCase();
    data.country=['US','USA','UNITED STATES','UNITED STATES OF AMERICA'].includes(country)?'US':country;
    data.state=data.state.toUpperCase();
    if(!data.name||!data.address1||!data.city||!states.has(data.state)||!/^\d{5}(-\d{4})?$/.test(data.postalCode))issues.push('ADDRESS_INCOMPLETE');
    if(data.country!=='US')issues.push('US_COUNTRY_REQUIRED');
    if(!data.filename&&!data.sessionId)issues.push('PHOTO_REFERENCE_MISSING');
    if(data.filename&&!/^[A-Za-z0-9_. -]+\.(jpe?g|png)$/i.test(data.filename))issues.push('PHOTO_REFERENCE_UNSUPPORTED');
    for(const field of ['mailingPreference','consent'])if(!data[field]||!(affirmative[field]||[]).includes(data[field]))issues.push(field==='consent'?'CONSENT_UNCONFIRMED':'MAILING_PREFERENCE_UNCONFIRMED');
    return {sourceRow:index+2,data,original:row,issues};
  })};
}
