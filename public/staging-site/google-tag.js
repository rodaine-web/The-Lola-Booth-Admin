// One Google tag for the public production website. No staff or private-document tracking.
(() => {
  if (!['thelolabooth.com', 'www.thelolabooth.com'].includes(window.location.hostname)) return;
  if (/^\/(?:pay|proposal|proposals|client|sales|finance|system)(?:\/|\.|$)/.test(window.location.pathname)) return;
  if (window.lolaGoogleTagInitialized) return;
  window.lolaGoogleTagInitialized = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', 'G-CJBCQ9FYL1');
  window.gtag('config', 'AW-18531982704');

  const reported = new Set();
  window.lolaTrackLeadConversion = (result, submissionId) => {
    // The API distinguishes a newly created lead from duplicate/replayed requests.
    if (result?.inquiryStatus !== 'CREATED_LEAD' || !submissionId || reported.has(submissionId)) return;
    try {
      window.gtag('event','generate_lead',{send_to:'G-CJBCQ9FYL1',form_type:/availability/.test(window.location.pathname)?'quote_request':'contact'});
      window.gtag('event', 'conversion', {
        send_to: 'AW-18531982704/JcHYCPPztaYdEPC63oRF',
        value: 1.0,
        currency: 'USD',
        transaction_id: submissionId
      });
      reported.add(submissionId);
    } catch { /* Measurement must never block a successful customer submission. */ }
  };

  // Only allowlisted interactions are collected; never field values or contact details.
  const experiences=new Set(['glam','360','mirror','vogue','virtual','audio']);
  function selectExperience(key){if(experiences.has(key))try{window.gtag('event','select_experience_'+key,{send_to:'G-CJBCQ9FYL1'});}catch{}}
  document.addEventListener?.('change',event=>{const el=event.target;if(el?.checked)selectExperience(el.dataset?.businessExperience||el.dataset?.experience);},true);
  document.addEventListener?.('click',event=>{const el=event.target?.closest?.('[data-package-experience]');if(el)selectExperience(el.dataset.packageExperience);},true);

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-CJBCQ9FYL1';
  document.head.appendChild(script);
})();
