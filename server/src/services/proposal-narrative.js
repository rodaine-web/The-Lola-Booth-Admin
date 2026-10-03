// Client-facing narrative uses document sections, never the editor's internal notes.
export function proposalNarrative(proposal, experiences = []) {
  const content = proposal.content || {};
  const sections = proposal.editable_sections || [];
  const sectionText = names => {
    const section = sections.find(section => names.includes(String(section.title || '').trim().toLowerCase()));
    return section ? [section.body, ...(section.items || [])].filter(Boolean).join('\n\n') : '';
  };
  const client = proposal.client_name || 'you';
  const event = proposal.event_name || proposal.event_type || 'your event';
  const selected = experiences.map(item => [item.name, item.package_name].filter(Boolean).join(' - ')).filter(Boolean).join(', ') || 'your selected LOLA experience';
  return {
    introduction: sectionText(['introduction', 'intro']) || content.introduction || `Thank you, ${client}, for considering The LOLA Booth for ${event}. We are excited to help bring people together through beautiful photographs and an experience your guests can enjoy. This proposal brings together your event details, selected experience, investment and the next steps for booking.`,
    aboutEvent: sectionText(['about the event', 'event details', 'event overview']) || content.eventVision || `For ${event}, we have prepared ${selected}. The event details below provide the starting point for planning. We will work with you to confirm the creative direction, placement and guest flow so the experience fits naturally into your celebration.`,
    notes: sectionText(['notes', 'client notes', 'event notes']) || content.clientNotes || 'Please review the event details, selected package and service window. Share any venue access requirements, setup restrictions, accessibility needs or creative preferences with the LOLA team. Any requested changes to the scope or investment will be confirmed before booking.',
    conclusion: sectionText(['conclusion', 'closing']) || content.conclusion || `Thank you for the opportunity to be part of ${event}. We look forward to creating a welcoming experience and memories your guests will keep. If everything looks right, review the next steps and accept your proposal when you are ready. If you would like any changes, contact the LOLA team so we can refine the proposal together.`,
    closing: content.closing || 'Good people. Better photos.\nThe LOLA Booth'
  };
}
