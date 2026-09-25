
    function downloadVCard(){
      const vcard = [
        'BEGIN:VCARD','VERSION:3.0','FN:The LOLA Booth','ORG:The LOLA Booth',
        'TEL;TYPE=WORK,VOICE:'+(window.LOLA_SITE_SETTINGS?.phone||'+17732402744').replace(/[^+0-9]/g,''),'EMAIL;TYPE=INTERNET,WORK:'+(window.LOLA_SITE_SETTINGS?.contact_email||'info@thelolabooth.com').replace(/[\r\n]/g,''),
        'URL:https://thelolabooth.com','X-SOCIALPROFILE;TYPE=instagram:'+(window.LOLA_SITE_SETTINGS?.instagram_url||'https://www.instagram.com/thelolabooth/').replace(/[\r\n]/g,''),
        'X-SOCIALPROFILE;TYPE=tiktok:'+(window.LOLA_SITE_SETTINGS?.tiktok_url||'https://www.tiktok.com/@thelolabooth').replace(/[\r\n]/g,''),
        'NOTE:Premium photo booth experiences for weddings, celebrations, corporate events and brands.','END:VCARD'
      ].join('\r\n');
      const blob = new Blob([vcard], {type:'text/vcard;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'The-LOLA-Booth.vcf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    document.getElementById('saveContact').addEventListener('click', downloadVCard);
    document.getElementById('saveContactBottom').addEventListener('click', downloadVCard);
  