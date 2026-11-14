const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const normalize = value => String(value || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9]/g, '');
const fields = {
  firstname:'first', lastname:'last', fullname:'full', recipientname:'full',
  streetaddress:'line1', addressline1:'line1', apartmentorsuiteoptional:'line2',
  apartmentorsuite:'line2', addressline2:'line2', city:'city', state:'state',
  stateprovince:'state', zipcode:'zip', zipcodepostalcode:'zip', postalcode:'zip', country:'country',
  mailingpreference:'preference', wouldyoulikeaphotopostcardfromthisevent:'preference',
  wouldyoulikeapostcardfromthisevent:'preference',
};
function physicalConsentQuestion(question) {
  if (['consenttopostcardmailing','physicalmailconsent'].includes(normalize(question))) return true;
  // Email/photo-sharing or marketing permissions never establish postal consent.
  if (/\b(e-?mail|sms|newsletter|marketing)\b/i.test(question)) return false;
  return /\b(agree|consent|permission|may)\b/i.test(question)
    && (/\bpostcards?\b/i.test(question) || /\bphysical\s+mail\b/i.test(question)
      || (/\b(photo(?:graph)?s?)\b/i.test(question) && /\bmailed\b/i.test(question)));
}
const answer = value => /^(yes|true|1|checked|i agree)$/i.test(value || '') ? true
  : /^(no|false|0|unchecked)$/i.test(value || '') ? false : null;

export function parseFiestaPostalAnswers(pairs,{defaultCountry}={}) {
  const values = {}, questions = {}, issues = [];
  const set = (key, question, value) => {
    if (Object.hasOwn(values, key) && values[key] !== value) issues.push('CONFLICTING_SURVEY_ANSWERS');
    values[key] = value; questions[key] = question;
  };
  for (const [question, value] of pairs) {
    const key = fields[normalize(question)];
    if (key) set(key, question, value.trim());
    if (physicalConsentQuestion(question)) {
      set('consent', question, value.trim());
      // A specific request to print AND mail the event photograph expresses preference too.
      if (/\b(?:photo(?:graph)?s?)\b/i.test(question) && /\bprinted\b/i.test(question) && /\bmailed\b/i.test(question)) set('combinedRequest',question,value.trim());
    }
  }
  if (!Object.keys(values).length) return null;
  if (!Object.hasOwn(values,'preference') && Object.hasOwn(values,'combinedRequest')) {
    values.preference=values.combinedRequest; questions.preference=questions.combinedRequest;
  }
  const countrySource=values.country?'SURVEY':defaultCountry==='US'?'ADMIN_US_ONLY_IMPORT':null;
  const country = String(values.country || (defaultCountry==='US'?'US':'')).trim().toUpperCase();
  const countryIsUS = ['US','USA','UNITED STATES','UNITED STATES OF AMERICA'].includes(country);
  const state = String(values.state || '').toUpperCase();
  const name = values.full || [values.first,values.last].filter(Boolean).join(' ');
  const addressComplete = Boolean((values.full || values.first && values.last) && values.line1 && values.city
    && STATES.has(state) && /^\d{5}(-\d{4})?$/.test(values.zip || '') && countryIsUS);
  if (!addressComplete) issues.push('ADDRESS_REVIEW_REQUIRED');
  if (!countryIsUS) issues.push('US_COUNTRY_REQUIRED');
  const preference = answer(values.preference), consent = answer(values.consent);
  if (preference === null) issues.push('MAILING_PREFERENCE_UNCONFIRMED');
  if (consent === null) issues.push('PHYSICAL_MAIL_CONSENT_UNCONFIRMED');
  const conflicts = issues.includes('CONFLICTING_SURVEY_ANSWERS');
  return {
    complete:addressComplete && !conflicts,
    consent:preference === true && consent === true && !conflicts,
    consentRecorded:preference !== null && consent !== null && !conflicts,
    mailingPreference:preference, physicalMailConsent:consent, countrySource,
    consentSource:JSON.stringify({preference:{question:questions.preference || null,answer:values.preference || null},consent:{question:questions.consent || null,answer:values.consent || null}}),
    issues:[...new Set(issues)],
    recipient:{name,address_line1:values.line1 || '',address_line2:values.line2 || '',address_city:values.city || '',address_state:state,address_zip:values.zip || '',address_country:countryIsUS?'US':country},
  };
}
