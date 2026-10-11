import AppearanceSettings from "../components/AppearanceSettings.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import "../styles/record-workspace.css";
import { Link } from "react-router-dom";

import AsyncState from "../components/AsyncState.jsx";
import RelationshipSelect from "../components/RelationshipSelect.jsx";
import { labelize } from "../utils/display.js";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { Building2, Bell, CreditCard, FileText, Globe2, SlidersHorizontal, Sparkles, UsersRound } from "lucide-react";

const sections=[
  ["Business Profile",Building2],
  ["Branding",Sparkles],
  ["Documents & Payments",FileText],
  ["Operations",UsersRound],
  ["Website",Globe2],
  ["Notifications",Bell],
  ["Appearance & Display",Sparkles],
  ["Advanced",SlidersHorizontal]
];

const fields=[
  "business_name","legal_business_name","business_email","phone","website","service_area","address","timezone","business_week_start","currency","sales_tax_percent","default_deposit_percent","default_balance_due_days","invoice_prefix","proposal_prefix","next_invoice_number","next_proposal_number","booking_confirmation_policy","default_deposit_type","default_deposit_value","default_balance_due_days_before_event","default_equipment_turnaround_buffer_minutes","default_staff_travel_buffer_minutes","setup_warning_minutes","event_start_warning_minutes","equipment_return_warning_hours","delivery_default_expiration_days","lead_assignment_mode","lead_assignment_user_id","auto_acknowledge_website_leads","auto_acknowledge_social_leads","google_review_url","facebook_review_url","other_review_url","offline_payment_instructions","proposal_default_validity_days","invoice_default_due_days","brand_line","proposal_acceptance_wording","proposal_default_intro","proposal_default_next_steps","proposal_default_terms","invoice_default_payment_terms","invoice_default_notes","default_setup_buffer_minutes","default_breakdown_buffer_minutes","default_planning_due_days","default_creative_due_days"
];

export default function Settings(){
  const {can}=useAuth();
  const [settings,setSettings]=useState(null);
  const [form,setForm]=useState({});
  const [notificationPrefs,setNotificationPrefs]=useState(null);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const [active,setActive]=useState(new URLSearchParams(window.location.search).get("section")==="appearance"?"Appearance & Display":"Business Profile");

  useEffect(()=>{
    if(!can("read:settings"))return;
    api.get("/settings").then(result=>{
      // Display the saved value so correcting legacy contact data is persisted.
      setSettings(result);setForm(result);
    }).catch(e=>setError(e.message));
    api.get("/notifications/preferences").then(setNotificationPrefs).catch(()=>null);
  },[revision]);

  async function save(){
    if(busy)return;setBusy(true);setNotice("");setError("");
    try{
      const changed=Object.fromEntries([...fields,"stripe_enabled"].filter(key=>form[key]!==null&&form[key]!==undefined&&JSON.stringify(form[key])!==JSON.stringify(settings[key])).map(key=>[key,key==="stripe_enabled"?Boolean(form[key]):form[key]]));
      if(JSON.stringify(form.sms_escalations)!==JSON.stringify(settings.sms_escalations))changed.sms_escalations=form.sms_escalations;
      if(!Object.keys(changed).length){setNotice("No changes to save.");return;}
      let updated=settings;
      if(Object.prototype.hasOwnProperty.call(changed,"stripe_enabled")){
        const payment=await api.patch("/settings/payment-checkout",{stripe_enabled:Boolean(changed.stripe_enabled)});
        updated={...updated,...payment};delete changed.stripe_enabled;
      }
      if(Object.keys(changed).length){const general=await api.patch("/settings",changed);updated={...updated,...general};}
      setSettings(updated);setForm(updated);setNotice("Settings saved.");
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }

  async function saveNotificationPrefs(){
    setNotice("");setError("");
    try{const updated=await api.patch("/notifications/preferences",notificationPrefs);setNotificationPrefs(updated);setNotice("Notification preferences saved.");}
    catch(err){setError(err.message);}
  }

  const groupFields=useMemo(()=>fields.filter(field=>sectionForField(field)===active),[active]);

  if(!can("read:settings"))return <main className="page settings-redesign"><h1>Settings</h1><AppearanceSettings/></main>;
  if(error&&!settings)return <main className="page"><AsyncState error={error} noun="settings" onRetry={()=>{setError("");setRevision(v=>v+1);}}/></main>;
  if(!settings)return <main className="page"><AsyncState loading noun="settings"/></main>;

  return <main className="page settings-redesign record-module">
    <section className="page-heading lola-page-heading">
      <div><p className="eyebrow">Settings</p><h1>Settings</h1><p className="lede">Configure your business.</p></div>
      {active!=="Appearance & Display"&&<div className="button-row"><Link className="lola-secondary-button" to="/system/proposal-templates">Proposal defaults</Link><button className="lola-secondary-button" onClick={()=>{setForm({...settings});setNotice("Unsaved changes reverted.");}}>Revert</button><button className="primary-action" disabled={busy} onClick={save}>{busy?"Saving...":"Save Changes"}</button></div>}
    </section>

    {(notice||error)&&<div className={error?"toast error":"toast"}>{error||notice}</div>}

    <div className="settings-shell">
      <aside className="settings-nav">
        {sections.map(([label,Icon])=><button key={label} className={active===label?"active":""} onClick={()=>setActive(label)}><Icon size={16}/><span>{label}</span></button>)}
      </aside>

      <section className="settings-content">
        {active==="Appearance & Display"?<AppearanceSettings/>:active==="Branding"?<Branding/>:active==="Notifications"?<Notifications prefs={notificationPrefs} setPrefs={setNotificationPrefs} save={saveNotificationPrefs}/>:active==="Documents & Payments"?<>
          <SettingsSection title="Documents & payments" description="Proposal, invoice, deposit, tax, and payment defaults.">
            <div className="settings-grid-redesign">{groupFields.map(field=><Setting key={field} field={field} value={form[field]} onChange={value=>setForm(current=>({...current,[field]:value}))}/>)}</div>
          </SettingsSection>
          <SettingsSection title="Payment checkout" description="Control staging payment checkout and offline instructions.">
            <div className="settings-grid-redesign">
              <label className="settings-toggle"><span><strong>Enable Stripe checkout</strong><small>Use the configured server-side Stripe integration.</small></span><input type="checkbox" checked={Boolean(form.stripe_enabled)} onChange={e=>setForm({...form,stripe_enabled:e.target.checked})}/></label>
              <Setting field="offline_payment_instructions" value={form.offline_payment_instructions} onChange={value=>setForm(current=>({...current,offline_payment_instructions:value}))}/>
            </div>
          </SettingsSection>
        </>:active==="Advanced"?<>
          <SettingsSection title="Automation & assignment" description="Lead assignment, acknowledgement, numbering, and system-level defaults.">
            <div className="settings-grid-redesign">{groupFields.map(field=><Setting key={field} field={field} value={form[field]} onChange={value=>setForm(current=>({...current,[field]:value}))}/>)}</div>
          </SettingsSection>
          <SettingsSection title="SMS escalation" description="SMS remains consent-gated and provider-dependent.">
            <div className="settings-grid-redesign">
              {["event_24h","overdue_balance","urgent_operations"].map(rule=><label className="settings-toggle" key={rule}><span><strong>{labelize(rule)}</strong><small>Allow this escalation when provider and consent requirements are satisfied.</small></span><input type="checkbox" checked={Boolean(form.sms_escalations?.[rule])} onChange={e=>setForm({...form,sms_escalations:{...form.sms_escalations,[rule]:e.target.checked}})}/></label>)}
              <label>Overdue days<input type="number" min="1" max="90" value={form.sms_escalations?.overdue_days||7} onChange={e=>setForm({...form,sms_escalations:{...form.sms_escalations,overdue_days:Number(e.target.value)}})}/></label>
            </div>
          </SettingsSection>
        </>:<SettingsSection title={active} description={sectionDescription(active)}>
          <div className="settings-grid-redesign">{groupFields.map(field=><Setting key={field} field={field} value={form[field]} onChange={value=>setForm(current=>({...current,[field]:value}))}/>)}</div>
        </SettingsSection>}
      </section>
    </div>
  </main>;
}

function SettingsSection({title,description,children}){return <section className="settings-card"><div className="settings-card-heading"><h2>{title}</h2><p>{description}</p></div>{children}</section>;}
function Setting({field,value,onChange}){return <label>{labelize(field)}<SettingInput field={field} value={value} onChange={onChange}/></label>;}

function Branding(){return <SettingsSection title="Branding" description="Default approved assets for the Admin Portal, Proposal Logo, Invoice Logo, Email Logo, receipts, and public pages."><div className="brand-redesign"><div className="brand-logo-card"><img src="/brand/LOLA_Primary_Dark_Transparent.png" alt="LOLA primary logo"/><strong>Primary Logo</strong><span>Good people. Better photos.</span></div><div className="brand-asset-row"><img src="/brand/LOLA_Horizontal_Dark_Transparent.png" alt="Horizontal LOLA logo"/><img src="/brand/LOLA_Primary_Dark_Transparent.png" alt="Primary LOLA logo"/><img src="/brand/LOLA_LB_Monogram_Gold.png" alt="LOLA monogram"/></div><div className="brand-swatches"><span style={{background:"#FAF7F1"}}>Ivory</span><span style={{background:"#D9C6A8"}}>Champagne</span><span style={{background:"#B89B6B",color:"#fff"}}>Gold</span><span style={{background:"#1A1A1A",color:"#fff"}}>Charcoal</span><span style={{background:"#E8DDD0"}}>Taupe</span></div></div></SettingsSection>;}

function Notifications({prefs,setPrefs,save}){
  if(!prefs)return <SettingsSection title="Notifications" description="Loading preferences..."><div className="empty-state">Loading notifications...</div></SettingsSection>;
  return <SettingsSection title="Notifications" description="Choose where routine updates appear. Critical alerts remain mandatory."><div className="settings-grid-redesign"><label className="settings-toggle"><span><strong>Critical alerts mandatory</strong><small>Security, payment integration, and critical incident alerts cannot be disabled.</small></span><input type="checkbox" checked disabled/></label><label className="settings-toggle"><span><strong>SMS notifications</strong><small>Deferred until a ready provider and recorded consent are available.</small></span><input type="checkbox" checked={prefs.sms_enabled===true} disabled/></label><label className="settings-toggle"><span><strong>In-app notifications</strong><small>Show updates inside LOLA Admin.</small></span><input type="checkbox" checked={prefs.in_app_enabled!==false} onChange={e=>setPrefs(current=>({...current,in_app_enabled:e.target.checked}))}/></label><label className="settings-toggle"><span><strong>Email notifications</strong><small>Send eligible updates by email.</small></span><input type="checkbox" checked={prefs.email_enabled!==false} onChange={e=>setPrefs(current=>({...current,email_enabled:e.target.checked}))}/></label>{["LEADS","EVENTS","STAFF","EQUIPMENT","PAYMENTS","SYSTEM","INCIDENTS","SALES"].map(category=><label className="settings-toggle" key={category}><span><strong>{labelize(category)}</strong><small>Routine {labelize(category).toLowerCase()} updates.</small></span><input type="checkbox" checked={(prefs.categories||{})[category]!==false} onChange={e=>setPrefs(current=>({...current,categories:{...(current.categories||{}),[category]:e.target.checked}}))}/></label>)}</div><div className="settings-footer"><button className="primary-action" onClick={save}>Save Notifications</button></div></SettingsSection>;
}

function sectionForField(field){
  if(["business_name","legal_business_name","business_email","phone","service_area","address"].includes(field))return"Business Profile";
  if(["website","google_review_url","facebook_review_url","other_review_url"].includes(field))return"Website";
  if(/proposal|invoice|deposit|payment|tax|currency|balance/.test(field))return"Documents & Payments";
  if(/equipment|staff|warning|buffer|delivery|planning|creative/.test(field))return"Operations";
  return"Advanced";
}
function sectionDescription(section){return({["Business Profile"]:"Core business identity and contact information.",Operations:"Timing buffers, equipment, staffing, and delivery defaults.",Website:"Public website and review destinations.",Advanced:"System defaults and assignment behavior."})[section]||"";}

function SettingInput({field,value,onChange}){
 const enums={lead_assignment_mode:["MANUAL","ROUND_ROBIN","SPECIFIC_USER","BY_SOURCE"],default_deposit_type:["PERCENTAGE","FIXED"],booking_confirmation_policy:["MANUAL","PROPOSAL_ACCEPTED","DEPOSIT_PAID","FULL_PAYMENT"]};
 if(field==="business_week_start")return <select value={value??1} onChange={e=>onChange(Number(e.target.value))}>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,i)=><option key={day} value={i}>{day}</option>)}</select>;
 if(field==="lead_assignment_user_id")return <RelationshipSelect resource="users" value={value} placeholder="Lead owner" onChange={onChange}/>;
 if(field.startsWith("auto_acknowledge"))return <input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked)}/>;
 if(enums[field])return <select value={value||""} onChange={e=>onChange(e.target.value)}><option value="">Select…</option>{[...new Set([value,...enums[field]].filter(Boolean))].map(v=><option key={v}>{v}</option>)}</select>;
 if(/terms|notes|intro|wording|instructions|next_steps|address/.test(field))return <textarea value={value||""} onChange={e=>onChange(e.target.value)}/>;
 const type=/email/.test(field)?"email":/url|website/.test(field)?"url":/phone/.test(field)?"tel":/days|minutes|hours|percent|number|deposit_value/.test(field)?"number":"text";
 return <input type={type} step={type==="number"?"any":undefined} value={value??""} onChange={e=>onChange(e.target.value)}/>;
}
