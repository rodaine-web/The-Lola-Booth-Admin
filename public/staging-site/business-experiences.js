(() => {
 const items=[
  {key:'glam',name:'The Lola Glam',category:'DSLR PHOTO BOOTH',crop:[51,365,286,168],description:'Professional DSLR photography for corporate events, branded campaigns, conferences and employee celebrations.',features:['Professional-quality photography','Custom branded photo templates','Digital photo sharing','Optional instant printing','Branded backdrops and overlays']},
  {key:'360',name:'The Lola 360',category:'VIDEO BOOTH',crop:[353,365,270,168],description:'An interactive 360° video experience for product launches, trade shows and corporate activations.',features:['Dynamic 360° videos','Branded video overlays','Music and effects','Instant digital sharing','Engaging social content']},
  {key:'mirror',name:'The Lola Magic Mirror',category:'MIRROR BOOTH',crop:[639,365,269,168],description:'An interactive, full-length mirror photo experience for gala dinners, corporate parties and premium events.',features:['Full-length interactive photography','On-screen animations','Branded photo layouts','Digital sharing','Available print options']},
  {key:'vogue',name:'The Lola Vogue',category:'MAGAZINE BOOTH',crop:[925,365,271,168],description:'A magazine-cover-inspired photo experience for luxury brands, corporate events and marketing activations.',features:['Magazine-style photo experience','Custom branded magazine covers','Editorial-style guest photographs','Digital sharing','Premium brand visibility']},
  {key:'virtual',name:'The Lola Virtual Booth',category:'VIRTUAL PHOTO BOOTH',crop:[1213,365,274,168],description:'A branded digital photo experience on a phone or computer, wherever your audience is.',features:['No physical booth required','Branded frames and overlays','Access by QR code or link','Digital sharing','For remote events, museums and ongoing activations']}
 ];
 window.LOLA_BUSINESS_EXPERIENCES=items;
 window.LOLA_VIRTUAL_DURATIONS={DAY:'24 Hours',THREE_DAYS:'3 Days',WEEK:'1 Week',MONTHLY:'Monthly Subscription'};
 // Reuse the owner-approved corporate photography directly, with SVG viewports.
 // The underlying reference stays intact; none of the surrounding mockup UI is shown.
 window.lolaBusinessPhoto=key=>{const item=items.find(i=>i.key===key),crop=key==='hero'?[570,52,966,217]:item.crop;return `<svg class="business-photo" preserveAspectRatio="xMidYMid slice" viewBox="${crop.join(' ')}" role="img" aria-label="${key==='hero'?'Corporate event photo experience':item.name+' at a business event'}"><image href="assets/business-corporate-reference.png" width="1536" height="1024"/></svg>`;};
})();
