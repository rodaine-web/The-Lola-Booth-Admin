import { createHash, randomUUID } from 'node:crypto';

export const checksum = buffer => createHash('sha256').update(buffer).digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const same = (a, b) => canonical(a) === canonical(b);
const projection = (row, desired) => Object.fromEntries(Object.keys(desired).map(k => [k, typeof desired[k] === 'number' && row[k] != null ? Number(row[k]) : row[k] ?? null]));
export function importDecision(current, desired, previous, baseline, allowSeed = false) {
  if (!current) return previous ? 'CONFLICT' : 'CREATE';
  if (current.deleted_at) return 'CONFLICT';
  if (same(projection(current, desired), desired)) return 'SKIP';
  if (previous) return same(projection(current, previous), previous) ? 'UPDATE' : 'CONFLICT';
  if (baseline) return same(projection(current, baseline), baseline) ? 'UPDATE' : 'CONFLICT';
  return allowSeed && !current.created_by && !current.updated_by && current.status === 'DRAFT' && new Date(current.updated_at).getTime() === new Date(current.created_at).getTime() ? 'UPDATE' : 'CONFLICT';
}

// The caller owns a REPEATABLE READ transaction. Dry runs only SELECT; apply is atomic.
export async function importWebsiteContent(db, manifest, { dryRun = true, storage, readAsset } = {}) {
  const hasState = (await db.query("SELECT to_regclass('website_import_state') AS state_table")).rows[0].state_table;
  if (!hasState && !dryRun) throw new Error('Apply website migration 021 before importing content.');
  const log = [], pending = [], states = new Map((hasState ? (await db.query('SELECT * FROM website_import_state')).rows : []).map(r => [r.import_key, r]));
  const tables = ['media_library','experiences','packages','website_content','website_event_types','website_hero_slides','website_gallery_items','faqs','testimonials','business_settings','website_page_items','website_media_mappings'];
  const rows = {};
  for (const table of tables) rows[table] = (await db.query(`SELECT * FROM ${table}`)).rows;
  const encode = (k, v) => ['body','snapshot','website_features','features'].includes(k) ? JSON.stringify(v) : v;
  function plan(table, key, desired, find, { baseline, allowSeed = false, area = table, asset } = {}) {
    const importKey = `${table}:${key}`, previous = states.get(importKey);
    const matches = rows[table].filter(find);
    const current = previous ? rows[table].find(r => r.id === previous.entity_id) : matches[0];
    const changedSinceCapture = !previous && baseline && current?.updated_at && manifest.baselineCapturedAt && new Date(current.updated_at) > new Date(manifest.baselineCapturedAt);
    const action = matches.length > 1 || changedSinceCapture ? 'CONFLICT' : importDecision(current, desired, previous?.snapshot, baseline, allowSeed);
    const id = current?.id || previous?.entity_id || randomUUID();
    const entry = { area, key, action, id, ...(action === 'CONFLICT' ? { reason: 'Existing, missing, archived, or manually changed record needs review; no overwrite.' } : {}) };
    log.push(entry);
    pending.push({table, importKey, id, desired, current, action, asset});
    return id;
  }
  const media = {};
  // Read existing bytes for hash dedupe, including media created before checksums existed.
  for (const row of rows.media_library.filter(r => !r.sha256 && !r.deleted_at && r.storage_provider === 'LOCAL')) {
    try { row.computed_sha256 = checksum(await storage.get(row.storage_key)); } catch { /* Missing files cannot be silently reused. */ }
  }
  for (const a of manifest.media) {
    const existing = rows.media_library.filter(r => r.sha256 === a.sha256 || r.computed_sha256 === a.sha256);
    if (existing.length) {
      const row = existing.find(r => !r.deleted_at && r.visibility === 'PUBLIC' && r.permission_state === 'APPROVED');
      if (!row) { log.push({area:'Media',key:a.path,action:'CONFLICT',reason:'Identical media is private, restricted, or deleted.'}); continue; }
      media[a.path] = row.id;
      log.push({area:'Media',key:a.path,action:'SKIP',id:row.id,reason:'Identical checksum; reuse existing approved media.'});
      continue;
    }
    media[a.path] = plan('media_library', a.path, {
      filename:a.filename, original_filename:a.filename, alt_text:a.alt, mime_type:a.mimeType, size_bytes:a.size, file_size:a.size,
      storage_provider:'LOCAL', storage_key:`website-import/${a.sha256}/${a.filename}`, visibility:'PUBLIC',permission_state:'APPROVED',media_type:'IMAGE',sha256:a.sha256,source_url:a.url
    }, r => r.source_url === a.url || r.filename === a.filename, {area:'Media',asset:a});
  }
  const identity = name => ['glam','360','vogue','audio'].find(k => String(name).toLowerCase().includes(k));
  const experienceIds = {};
  for (const e of manifest.experiences) {
    const old = manifest.baseline.experiences.find(r => identity(r.name) === e.key);
    const baseline = old && Object.fromEntries(['name','website_short_description','website_long_description','display_order','base_price','features','cover_image_media_id'].filter(k=>old[k] !== undefined).map(k=>[k,k==='base_price'?Number(old[k]):old[k]]));
    experienceIds[e.key] = plan('experiences',e.key,{
      name:e.name,website_name:e.name,website_heading:e.heading||null,website_kicker:e.kicker||null,website_label:e.pageLabel||null,slug:old?.slug || `lola-${e.key}`,website_short_description:e.homeDescription,website_long_description:e.description,features:e.features,
      base_price:Math.min(...manifest.packages.filter(p=>p.experience===e.key&&p.starting_price!=null).map(p=>p.starting_price)),display_order:e.order,cover_image_media_id:media[e.asset] || null,show_on_website:true,active:true,website_status:'PUBLISHED'
    },r=>r.id===old?.id || identity(r.name)===e.key,{baseline,area:'Experiences'});
  }
  // Retire only the two legacy website seed experiences, preserving internal use.
  for (const old of manifest.baseline.experiences.filter(e=>!identity(e.name))) {
    const baseline={name:old.name,show_on_website:true,active:true};
    plan('experiences',`retire:${old.id}`,{show_on_website:false},r=>r.id===old.id,{baseline,area:'Experiences'});
  }
  for (const p of manifest.packages) {
    const tier=p.key.split(':')[1];
    const old=p.experience==='glam' ? manifest.baseline.packages.find(r=>String(r.name).toLowerCase().includes(tier)) : null;
    const baseline=old && Object.fromEntries(['name','starting_price','website_short_description','most_popular','website_display_order'].filter(k=>old[k]!==undefined).map(k=>[k,k==='starting_price'?Number(old[k]):old[k]]));
    plan('packages',p.key,{
      website_key:p.key,name:p.name,experience_id:experienceIds[p.experience],starting_price:p.starting_price,pricing_mode:p.pricing_mode,website_short_description:p.description,
      website_home_description:p.homeDescription||null,website_features:p.features,website_custom_heading:p.custom_heading,most_popular:p.most_popular,website_display_order:p.order,display_order:p.order,website_status:'PUBLISHED',show_on_website:true,active:true
    },r=>r.website_key===p.key || r.id===old?.id || (r.experience_id===experienceIds[p.experience] && r.name.toLowerCase()===p.name.toLowerCase()),{baseline,area:'Packages'});
  }
  for (const e of manifest.events) plan('website_event_types',e.key,{
    name:e.name,slug:e.key,home_description:e.homeDescription||null,home_display_order:e.homeOrder||e.order,short_description:e.description,image_media_id:media[e.asset] || null,display_order:e.order,show_on_website:true,status:'PUBLISHED'
  },r=>r.slug===e.key,{allowSeed:true,area:'Events'});
  for(const s of manifest.hero) plan('website_hero_slides',s.asset,{desktop_image_file_id:media[s.asset]||null,image_media_id:media[s.asset]||null,alt_text:s.alt,display_order:s.order,is_active:true,status:'PUBLISHED'},r=>(r.desktop_image_file_id||r.image_media_id)===media[s.asset],{area:'Hero'});
  for(const g of manifest.gallery) plan('website_gallery_items',g.asset,{media_id:media[g.asset]||null,alt_text:g.alt,category:g.category,title:g.title||null,caption:g.caption||null,tags:g.tags||[],display_order:g.order,status:'PUBLISHED'},r=>r.media_id===media[g.asset],{area:'Gallery'});
  for(const f of manifest.faqs) {
    const desired={question:f.question,answer:f.answer,category:f.category||null,display_order:f.display_order,status:'PUBLISHED'};
    plan('faqs',f.id,desired,r=>r.id===f.id||r.question===f.question,{baseline:desired,area:'FAQs'});
  }
  // Import only verbatim testimonials found in the current live source.
  for(const t of manifest.testimonials || []) {
    const desired={client_name:t.client_name,client_display_name:t.client_display_name||t.client_name,event_type:t.event_type||null,quote:t.quote,rating:t.rating||5,display_order:t.display_order,status:t.status||'PUBLISHED'};
    plan('testimonials',t.client_name,desired,r=>r.client_name===t.client_name,{area:'Testimonials'});
  }
  for(const t of rows.testimonials.filter(row=>!(manifest.testimonials||[]).some(x=>x.client_name===row.client_name)))log.push({area:'Testimonials',key:t.id,action:'SKIP',reason:'Preserve existing publication state and manual content.'});
  const content=(key,title,body,area='Homepage')=>plan('website_content',key,{content_key:key,title,body,status:'PUBLISHED'},r=>r.content_key===key,{area});
  for(const p of manifest.pages) content(`page.${p.slug}`,`${p.slug}: approved page copy and SEO`,{copy:p.copy,title:p.title,seo:p.seo},p.slug==='about'?'About':p.slug==='connect'?'/connect':'Homepage');
  content('experience.details','Experience headings and supporting copy',Object.fromEntries(manifest.experiences.map(e=>[e.key,{heading:e.heading,kicker:e.kicker,pageLabel:e.pageLabel}])),'Experiences');
  content('events.home_order','Homepage event order and copy',manifest.events.map(e=>({slug:e.key,order:e.homeOrder,description:e.homeDescription})),'Events');
  content('website.media','Approved website image mapping',Object.fromEntries(Object.entries(media).map(([key,id])=>[key,`/api/public/media/${id}`])),'Media');
  for(const page of manifest.pages) for(const [index,[key,value]] of Object.entries(page.copy).sort(([a],[b])=>a.localeCompare(b)).entries()) {
    plan('website_page_items',key,{page_slug:page.slug,slot_key:key,html:value.html||'',href:value.href||null,display_order:index+1,status:'PUBLISHED'},r=>r.slot_key===key,{area:'Page Items'});
  }
  for(const [index,key] of Object.keys(media).sort().entries()) plan('website_media_mappings',key,{asset_key:key,media_id:media[key],display_order:index+1,status:'PUBLISHED'},r=>r.asset_key===key,{area:'Website Images'});

  const settings=rows.business_settings[0];
  const settingBaseline=Object.fromEntries(Object.keys(manifest.settings).map(k=>[k,manifest.baseline.settings[k]??null]));
  plan('business_settings','site',manifest.settings,r=>r.id===settings?.id,{baseline:settingBaseline,area:'Site Settings'});
  if (!dryRun && log.some(e=>e.action==='CONFLICT')) throw Object.assign(new Error('Import has conflicts. Review dry-run; no database content changed.'),{report:log});
  if (!dryRun) {
    for(const p of pending) {
      if(p.action==='CONFLICT')continue;
      if(p.asset && p.action==='CREATE') {
        const bytes=await readAsset(p.asset);
        if(checksum(bytes)!==p.asset.sha256)throw new Error(`Source asset changed: ${p.asset.path}`);
        if(storage.putAt) await storage.putAt({buffer:bytes,storageKey:p.desired.storage_key});
        else throw new Error('Content-addressed storage writer is required.');
      }
      if(p.action!=='SKIP') {
        const keys=Object.keys(p.desired),values=keys.map(k=>encode(k,p.desired[k]));
        if(p.action==='CREATE') await db.query(`INSERT INTO ${p.table} (id,${keys.join(',')}) VALUES ($1,${keys.map((_,i)=>`$${i+2}`).join(',')})`,[p.id,...values]);
        else await db.query(`UPDATE ${p.table} SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_at=now() WHERE id=$${keys.length+1}`, [...values,p.id]);
        if(p.current) await db.query('INSERT INTO website_content_versions (entity_type,entity_id,snapshot,action) VALUES ($1,$2,$3,$4)',[p.table,p.id,JSON.stringify(p.current),'live-website-import']);
      }
      await db.query(`INSERT INTO website_import_state (import_key,entity_id,snapshot) VALUES ($1,$2,$3) ON CONFLICT (import_key) DO UPDATE SET entity_id=EXCLUDED.entity_id,snapshot=EXCLUDED.snapshot,imported_at=now()`,[p.importKey,p.id,JSON.stringify(p.desired)]);
    }
  }
  return log;
}
