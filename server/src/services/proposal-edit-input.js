export function proposalEditInput(proposal) {
  const lines = proposal.line_items_snapshot || [];
  const content = proposal.content || {};
  const amount = type => lines.filter(line => line.type === type).reduce((sum, line) => sum + Number(line.line_total || 0), 0);
  return {
    ...proposal,
    ...proposal.pricing_snapshot,
    scenario_enabled: Boolean(content.scenario),
    scenario_overrides: content.scenario_overrides || {},
    event_type: content.scenario?.eventType,
    event_details: content.scenario?.details,
    client_details: content.scenario?.client,
    customer_notes: content.scenario?.customer_notes,
    proposal_type: proposal.proposal_type || 'PRIVATE_EVENT',
    selected_experiences: proposal.selected_experiences || [],
    proposal_visuals: proposal.proposal_visuals || {},
    package_amount: amount('PACKAGE'), experience_surcharge: amount('EXPERIENCE'),
    travel: amount('TRAVEL'), other_fees: amount('OTHER'),
    addons: lines.filter(line => line.type === 'ADDON').map(line => ({...line})),
    custom_line_items: lines.filter(line => !['PACKAGE','EXPERIENCE','EXPERIENCE_SELECTED','ADDON','TRAVEL','OTHER'].includes(line.type)).map(line => ({...line})),
    introduction: content.scenario ? undefined : content.introduction, experience_name: content.experienceName,
    experience_description: content.experienceDescription, package_name: content.packageName,
    package_description: content.packageDescription, next_steps: content.scenario ? undefined : content.nextSteps, terms: content.scenario ? undefined : content.terms,
    sections: proposal.editable_sections || [],
    proposal_date: proposal.proposal_date ? new Date(proposal.proposal_date).toISOString().slice(0,10) : null,
    valid_through: proposal.valid_through ? new Date(proposal.valid_through).toISOString().slice(0,10) : null
  };
}
