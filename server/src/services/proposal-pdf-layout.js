// Measured, paginated proposal layout. Every page shares one grid and footer.
export function renderProposalPdf(doc, proposal, { brand, logo, experiences, features, image, strip, money, footer }) {
  let page = 0;
  const text = (value, x, y, width, size = 10, font = 'Helvetica', color = brand.charcoal) => {
    doc.fillColor(color).font(font).fontSize(size).text(String(value ?? ''), x, y, { width, lineGap: 3, characterSpacing: 0 });
    return doc.y;
  };
  const height = (value, width, size = 10, font = 'Helvetica') => doc.font(font).fontSize(size).heightOfString(String(value), {width, lineGap:3, characterSpacing:0});
  const start = (label, title) => {
    if (page) doc.addPage();
    page++;
    doc.rect(0,0,612,792).fill(brand.ivory);
    if (logo) doc.image(logo,42,32,{width:105});
    text(proposal.proposal_number || 'LOLA PROPOSAL',400,52,170,8,'Helvetica',brand.muted);
    doc.moveTo(42,119).lineTo(570,119).strokeColor(brand.taupe).stroke();
    text(label.toUpperCase(),42,140,528,8,'Helvetica-Bold',brand.gold);
    const y = text(title,42,162,528,28,'Times-Roman') + 24;
    doc.moveTo(42,712).lineTo(570,712).strokeColor(brand.taupe).stroke();
    text(footer,42,727,470,7,'Helvetica',brand.muted);
    text(String(page),548,727,22,8,'Helvetica',brand.muted);
    return y;
  };
  const flow = (value, initialY, title, size = 10) => {
    let y = initialY;
    // Wrap explicitly to keep arbitrary saved terms/notes above the footer.
    for (const paragraph of String(value || '').split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let line = '';
      const lines = [];
      for (let word of words) {
        while (doc.font('Helvetica').fontSize(size).widthOfString(word) > 528) {
          if(line){lines.push(line);line='';}
          let end=word.length;
          while(doc.widthOfString(word.slice(0,end))>528)end--;
          lines.push(word.slice(0,end));word=word.slice(end);
        }
        if(doc.widthOfString(line ? `${line} ${word}` : word)>528){lines.push(line);line=word;}else line=line?`${line} ${word}`:word;
      }
      if(line)lines.push(line);
      for(const line of lines){if(y+size+6>670)y=start('Continued',title);y=text(line,42,y,528,size)+2;}
      y+=8;
    }
    return y;
  };
  const photo = (source,x,y,w,h) => {
    if (!source) return;
    doc.rect(x,y,w,h).fill('#eee7dd');
    doc.image(source,x,y,{fit:[w,h],align:'center',valign:'center'});
  };
  const date = proposal.event_date ? new Date(proposal.event_date) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}) : 'To be confirmed';
  const timeLabel = value => {const match=String(value||'').match(/^(\d{1,2}):(\d{2})/);if(!match)return '';const hour=Number(match[1]);return `${hour%12||12}:${match[2]} ${hour>=12?'PM':'AM'}`;};
  const time = [timeLabel(proposal.start_time),timeLabel(proposal.end_time)].filter(Boolean).join(' - ');
  const facts = [['EVENT',proposal.event_name||proposal.event_type||'To be confirmed'],['DATE & TIME',`${dateLabel}${time?` | ${time}`:''}`],['VENUE',proposal.venue_name||'To be confirmed'],['GUESTS',proposal.guest_count??'To be confirmed']];
  let y=start(proposal.proposal_type==='WEDDING'?'WEDDING EXPERIENCE PROPOSAL':'EVENT EXPERIENCE PROPOSAL','Your event. Beautifully captured.');
  y=text(`Prepared for ${proposal.client_name||'you'}`,42,y,528,15,'Times-Roman')+18;
  const first=experiences[0];
  if(first){photo(image(first),42,y,528,260);y+=281;}
  text(experiences.map(item=>item.name).filter(Boolean).join(' + ') || 'A custom LOLA experience',42,y,528,18,'Times-Roman');
  text('Good people. Better photos.',42,660,528,11,'Times-Italic',brand.gold);

  y=start('Event overview','Made for your celebration.');
  for(const [label,value] of facts){text(label,42,y,132,8,'Helvetica-Bold',brand.gold);const bottom=text(value,184,y-2,386,13,'Times-Roman');y=Math.max(y+46,bottom+18);doc.moveTo(42,y-12).lineTo(570,y-12).strokeColor(brand.taupe).stroke();}
  y+=20;
  y=text('The event vision',42,y,528,20,'Times-Roman')+14;
  y=flow(strip(proposal.content?.eventVision || 'An inviting guest experience, thoughtful creative and professional service from setup through breakdown.'),y,'The event vision');
  y=text('THE LOLA STANDARD',42,y+20,528,8,'Helvetica-Bold',brand.gold)+16;
  flow('Beautifully presented equipment and creative. Friendly professional service. Memories made to save and share.',y,'The LOLA standard');

  for(const [index,item] of experiences.entries()){
    y=start(`Experience ${String(index+1).padStart(2,'0')}`,item.name||'LOLA Experience');
    const packageName=item.package_name||item.packages?.map(p=>p.name).filter(Boolean).join(' + ');
    if(packageName)y=text(packageName,42,y,528,11,'Helvetica-Bold',brand.gold)+18;
    photo(image(item),42,y,235,300);
    let right=text(item.headline || 'A moment worth remembering.',301,y,269,20,'Times-Roman')+14;
    right=text(strip(item.description||'A premium LOLA experience designed around your event.'),301,right,269,10,'Helvetica',brand.muted)+16;
    for(const feature of features(item)){
      const h=height(feature,251,9);
      if(right+h>680){y=start('Experience details',item.name||'LOLA Experience');right=y;}
      doc.circle(305,right+5,2).fill(brand.gold);
      right=text(strip(feature),319,right,251,9)+10;
    }
  }

  // Group supporting photographs into a consistent gallery; omit the hero already shown.
  const heroUris=new Set(experiences.map(item=>item.visuals?.hero).filter(Boolean));
  const used=new Set();
  for(const section of proposal.visual_sections||[]){
    const photos=(section.images||[]).filter(p=>p.dataUri?.startsWith('data:image/')&&!heroUris.has(p.dataUri)&&!used.has(p.dataUri));
    photos.forEach(p=>used.add(p.dataUri));
    for(let offset=0;offset<photos.length;offset+=4){
      y=start('Experience photography',section.title||'The details make the difference.');
      if(section.body)y=text(strip(section.body),42,y,528,9,'Helvetica',brand.muted)+18;
      const h=Math.min(195,(660-y-64)/2);
      photos.slice(offset,offset+4).forEach((p,i)=>{const x=42+(i%2)*272,top=y+Math.floor(i/2)*(h+44);photo(Buffer.from(p.dataUri.split(',')[1],'base64'),x,top,256,h);text(p.alt||'Experience detail',x,top+h+10,256,9,'Helvetica',brand.muted);});
    }
  }

  y=start('Investment','Your selected experience.');
  const items=proposal.line_items_snapshot||[];
  for(const item of items){
    const label=strip(item.description||'Experience');const h=Math.max(36,height(label,370,10)+18);
    if(y+h>570)y=start('Investment continued','Your selected experience.');
    text(label,42,y,370);text(money(item.line_total),432,y,138,10,'Helvetica-Bold');
    y+=h;doc.moveTo(42,y-10).lineTo(570,y-10).strokeColor(brand.taupe).stroke();
  }
  if(y+130>685)y=start('Investment','Your total investment.');
  const pricing=proposal.pricing_snapshot||{};
  for(const [label,value] of [['Subtotal',pricing.subtotal],['Discount',pricing.discount],['Tax',pricing.tax]]){
    if(value==null || (label!=='Subtotal' && Number(value)===0))continue;
    if(y+165>685)y=start('Investment','Your total investment.');
    text(label,42,y,370,10);text(`${label==='Discount'?'-':''}${money(value)}`,432,y,138,10);y+=28;
  }
  if(y+130>685)y=start('Investment','Your total investment.');
  text('Total investment',42,y+10,370,20,'Times-Roman');text(money(pricing.total??proposal.total),432,y+10,138,20,'Times-Roman');y+=62;
  text(`Due to reserve your date: ${money(pricing.deposit_amount??pricing.total??proposal.total)}`,42,y,528,12,'Helvetica-Bold',brand.gold);
  text('Your date is secured when the required booking documents and down payment are completed.',42,y+28,528,10,'Helvetica',brand.muted);

  y=start('Next steps','From proposal to booked.');
  for(const [i,[title,body]] of [['Accept your proposal','Confirm the selected experiences and scope.'],['Complete your booking','LOLA will provide your invoice and required booking documents.'],['Approve your creative','Review the guest-facing creative before your event.']].entries()){
    text(String(i+1).padStart(2,'0'),42,y,32,11,'Helvetica-Bold',brand.gold);
    text(title,92,y-2,478,18,'Times-Roman');y=text(body,92,y+26,478,10,'Helvetica',brand.muted)+27;
  }
  y=text('Terms & notes',42,y+10,528,18,'Times-Roman')+16;
  flow(strip(proposal.content?.terms || 'Booking is subject to confirmed event details and the required booking documents.'),y,'Terms & notes');
  if(!proposal.proposal_type)for(const section of proposal.editable_sections||[]){y=start('Additional details',section.title||'Event details');flow(strip([section.body,...(section.items||[])].filter(Boolean).join('\n')),y,section.title||'Event details');}
}
