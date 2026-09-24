export function proposalEditInput(proposal) {
  const lines = proposal.line_items_snapshot || [];
  const content = proposal.content || {};
  const amount = type => lines.filter(line => line.type === type).reduce((sum, line) => sum + Number(line.line_total || 0), 0);
  return {
    ...proposal,
    ...proposal.pricing_snapshot,
    package_amount: amount('PACKAGE'), experience_surcharge: amount('EXPERIENCE'),
    travel: amount('TRAVEL'), other_fees: amount('OTHER'),
    addons: lines.filter(line => line.type === 'ADDON').map(line => ({...line})),
    custom_line_items: lines.filter(line => !['PACKAGE','EXPERIENCE','ADDON','TRAVEL','OTHER'].includes(line.type)).map(line => ({...line})),
    introduction: content.introduction, experience_name: content.experienceName,
    experience_description: content.experienceDescription, package_name: content.packageName,
    package_description: content.packageDescription, next_steps: content.nextSteps, terms: content.terms,
    sections: proposal.editable_sections || [],
    proposal_date: proposal.proposal_date ? new Date(proposal.proposal_date).toISOString().slice(0,10) : null,
    valid_through: proposal.valid_through ? new Date(proposal.valid_through).toISOString().slice(0,10) : null
  };
}
