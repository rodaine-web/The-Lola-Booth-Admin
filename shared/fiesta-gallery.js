const fail=message=>{const error=new Error(message);error.code='FIESTA_CSV_INVALID';throw error;};
const headers=['Shared via','Email Address','Phone Number','Content Link','File Name','Share Time'];

// RFC-style CSV, bounded before parsing. Never evaluate cells or fetch Content Link.
export function parseFiestaShares(text,expectedEvent){
 if(typeof text!=='string'||text.length>1024*1024)fail('Use a Fiesta sharing CSV up to 1 MB.');
 const grid=[];let row=[],cell='',quoted=false,closed=false;
 const field=()=>{row.push(cell);cell='';closed=false;};
 const record=()=>{field();if(row.some(v=>v.trim()))grid.push(row);row=[];if(grid.length>5001)fail('Use at most 5,000 sharing records.');};
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
  else if(c==='"'){if(cell||closed)fail('Malformed CSV quoting.');quoted=true;}
  else if(c===',')field();
  else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;record();}
  else{if(closed)fail('Malformed CSV quoting.');cell+=c;}
 }
 if(quoted)fail('Unclosed CSV quote.');if(cell||row.length||closed)record();
 if(!grid.length||grid[0].length!==6||headers.some((h,i)=>grid[0][i].trim()!==h))fail('Use the original Fiesta sharing CSV with all six columns.');
 const records=[],seen=new Set(),fileLinks=new Map(),linkFiles=new Map();let eventCode;
 for(const [index,values] of grid.slice(1).entries()){
  const n=index+2;if(values.length!==6)fail(`CSV row ${n} has an unexpected number of columns.`);
  const [via,email,phone,link,filename,sharedAt]=values.map(v=>v.trim());
  if(!/^[A-Za-z0-9_-]+\.(jpe?g|png|gif|mp4)$/i.test(filename))fail(`CSV row ${n} has an invalid capture filename.`);
  let u;try{u=new URL(link);}catch{fail(`CSV row ${n} has an invalid content link.`);}
  const parts=u.pathname.split('/').filter(Boolean);
  if(u.protocol!=='https:'||u.hostname!=='boothpics.com'||u.port||u.username||u.password||u.search||u.hash||parts.length!==2||parts.some(p=>!/^[A-Za-z0-9_-]+$/.test(p)))fail(`CSV row ${n} has an unsupported content link.`);
  eventCode??=parts[0];if(eventCode!==parts[0]||(expectedEvent&&parts[0]!==expectedEvent))fail('The CSV belongs to a different Fiesta event.');
  if((fileLinks.has(filename)&&fileLinks.get(filename)!==link)||(linkFiles.has(link)&&linkFiles.get(link)!==filename))fail('A capture filename has conflicting content links.');
  fileLinks.set(filename,link);linkFiles.set(link,filename);
  const channel=via==='E-mail'?'EMAIL':via==='Phone number'?'SMS':null;
  if(!channel||(channel==='EMAIL'&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||phone))||(channel==='SMS'&&(!/^\+?[1-9]\d{7,14}$/.test(phone)||email)))fail(`CSV row ${n} has an invalid recipient or sharing method.`);
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} [A-Z]{2,5}$/.test(sharedAt))fail(`CSV row ${n} has an invalid sharing time.`);
  const recipient=channel==='EMAIL'?email.toLowerCase():'+'+phone.replace(/^\+/,''),key=JSON.stringify([filename,channel,recipient]);
  if(!seen.has(key)){seen.add(key);records.push({filename,channel,recipient,captureRef:parts[1],sharedAt});}
 }
 if(!records.length)fail('The CSV has no sharing records.');
 return {eventCode,records,sharingRows:grid.length-1,captures:fileLinks.size};
}

export function galleryRetentionDays(names){
 const days=names.map(name=>({essential:30,signature:60,luxe:90})[String(name).trim().toLowerCase().replace(/^the\s+/,'')]);
 return days.length&&days.every(Boolean)?Math.max(...days):null;
}
