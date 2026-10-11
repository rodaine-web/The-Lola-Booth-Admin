import {normalizeScenarioEvent} from './proposal-scenario.js';

// Booking selections use catalog IDs, never ambiguous package tier names.
export function proposalBookingPrefill(lead, catalogExperiences = [], catalogPackages = []) {
  const pkg = lead.preferredPackage || catalogPackages.find(item => item.id === lead.preferred_package_id);
  const experienceId = lead.preferred_experience_id || lead.preferredExperience?.id || pkg?.experience_id;
  const experience = lead.preferredExperience || catalogExperiences.find(item => item.id === experienceId);
  const eventType = normalizeScenarioEvent(lead.event_type);
  const eventName = lead.event_name || [lead.event_type, [lead.first_name, lead.last_name].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const fields = {
    first_name: lead.first_name || '', last_name: lead.last_name || '', email: lead.email || '', phone: lead.phone || '',
    company: lead.company || lead.company_name || '', zip: lead.zip || '',
    estimated_budget: lead.estimated_budget ?? lead.budget ?? '', source: lead.referral_source || lead.lead_source || lead.source || '',
    event_name: eventName, proposal_title: eventName, event_type: eventType,
    custom_event_type: eventType === 'Other' ? lead.event_type || '' : '',
    event_date: lead.event_date ? String(lead.event_date).slice(0, 10) : '',
    start_time: lead.event_start_time || '', end_time: lead.event_end_time || '', guest_count: lead.guest_count ?? '',
    venue_name: lead.venue_name || '', venue_address: lead.venue_address || '', city: lead.city || '', state: lead.state || '',
    customer_notes: lead.message || '', notes: lead.notes || ''
  };
  const matchingPackage = pkg && (!pkg.experience_id || pkg.experience_id === experienceId) ? pkg : null;
  const selectedExperiences = experienceId ? [{
    experience_id: experienceId, name: experience?.name || '',
    description: experience?.proposal_description || experience?.description || '',
    packages: matchingPackage ? [{package_id: matchingPackage.id, name: matchingPackage.name,
      price: Number(matchingPackage.starting_price || 0), description: matchingPackage.proposal_description || matchingPackage.description || '',
      included_hours: matchingPackage.included_hours, duration: matchingPackage.duration,
      features: matchingPackage.items?.length ? matchingPackage.items : matchingPackage.website_features || []}] : [],
    price: Number(matchingPackage?.starting_price ?? experience?.base_price ?? 0)
  }] : [];
  const inquiry=lead.source_details?.bookingInquiry;
  const requested=inquiry?.selections?.map(item=>{
    const experience=catalogExperiences.find(x=>x.id===item.experienceId);
    const selectedPackage=catalogPackages.find(x=>x.id===item.packageId&&x.experience_id===item.experienceId);
    return {experience_id:item.experienceId,name:experience?.name||item.experienceName,description:experience?.description||'',price:item.pricingMode==='CUSTOM'?0:Number(selectedPackage?.starting_price??item.startingPrice??0),packages:[{package_id:item.packageId,name:selectedPackage?.name||item.packageName,price:item.pricingMode==='CUSTOM'?0:Number(selectedPackage?.starting_price??item.startingPrice??0),description:[selectedPackage?.description,item.customNotes].filter(Boolean).join('\n'),pricing_mode:item.pricingMode,included_hours:selectedPackage?.included_hours,duration:selectedPackage?.duration,features:selectedPackage?.items?.length?selectedPackage.items:selectedPackage?.website_features||[]}]};
  });
  const selectedAddons=(inquiry?.addons||[]).map(item=>({addon_id:item.addonId,description:item.name,quantity:item.quantity,unit_price:item.unitPrice,pricing_type:item.pricingType}));
  if(inquiry?.eventName){fields.event_name=inquiry.eventName;fields.proposal_title=inquiry.eventName;}
  return {fields, selectedExperiences:requested?.length?requested:selectedExperiences,selectedAddons};
}
