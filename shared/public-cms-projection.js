// Keep the existing website payload contract while the CMS edits individual slots.
export function projectPageContent(rows, pageItems, mediaMappings, hiddenPageItems = []) {
  const content = Object.fromEntries(rows.map(row => [row.content_key, {...row, body: structuredClone(row.body || {})}]));
  for (const item of [...hiddenPageItems.map(item => ({...item, html:'', href:null})), ...pageItems]) {
    const key = `page.${item.page_slug}`;
    const page = content[key] ||= {content_key:key, status:'PUBLISHED', body:{}};
    page.body.copy ||= {};
    page.body.copy[item.slot_key] = {html:item.html, ...(item.href ? {href:item.href} : {})};
  }
  if (mediaMappings.length) {
    const mapping = content['website.media'] ||= {content_key:'website.media', status:'PUBLISHED', body:{}};
    for (const item of mediaMappings) mapping.body[item.asset_key] = `/api/public/media/${item.media_id}`;
  }
  return content;
}
