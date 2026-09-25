import AsyncState from "../components/AsyncState.jsx";
import RelationshipSelect from "../components/RelationshipSelect.jsx";
import {labelize} from "../utils/display.js";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [notificationPrefs, setNotificationPrefs] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy,setBusy]=useState(false),[revision,setRevision]=useState(0);

  useEffect(() => {
    api.get("/settings").then((result) => {
      setSettings(result);
      setForm({...result,business_email:result.business_email==='hello@lolabooths.com'?'info@thelolabooth.com':result.business_email});
    }).catch(e=>setError(e.message));
    api.get("/notifications/preferences").then(setNotificationPrefs).catch(() => null);
  }, [revision]);

  async function save() {
    if(busy)return;setBusy(true);
    setNotice("");
    setError("");
    try {
      const updated = await api.patch("/settings", {...Object.fromEntries(fields.filter(k=>form[k]!==null&&form[k]!==undefined).map(k=>[k,form[k]])),sms_escalations:form.sms_escalations,stripe_enabled:Boolean(form.stripe_enabled)});
      setSettings(updated);
      setForm(updated);
      setNotice("Settings saved.");
    } catch (err) {
      setError(err.message);
    } finally {setBusy(false);}
  }

  async function saveNotificationPrefs(nextPrefs = notificationPrefs) {
    setNotice("");
    setError("");
    try {
      const updated = await api.patch("/notifications/preferences", nextPrefs);
      setNotificationPrefs(updated);
      setNotice("Notification preferences saved.");
    } catch (err) {
      setError(err.message);
    }
  }

  function updateCategory(category, enabled) {
    const nextPrefs = {
      ...notificationPrefs,
      categories: { ...(notificationPrefs?.categories || {}), [category]: enabled }
    };
    setNotificationPrefs(nextPrefs);
  }

  if(error&&!settings)return <main className="page"><AsyncState error={error} noun="settings" onRetry={()=>{setError("");setRevision(r=>r+1);}}/></main>;
  if (!settings) return <main className="page"><div className="empty-state">Loading settings...</div></main>;

  const fields = ["business_name", "legal_business_name", "business_email", "phone", "website", "service_area", "address", "timezone", "business_week_start", "currency", "sales_tax_percent", "default_deposit_percent", "default_balance_due_days", "invoice_prefix", "proposal_prefix", "next_invoice_number", "next_proposal_number", "booking_confirmation_policy", "default_deposit_type", "default_deposit_value", "default_balance_due_days_before_event", "default_equipment_turnaround_buffer_minutes", "default_staff_travel_buffer_minutes", "setup_warning_minutes", "event_start_warning_minutes", "equipment_return_warning_hours", "delivery_default_expiration_days", "lead_assignment_mode", "lead_assignment_user_id", "auto_acknowledge_website_leads", "auto_acknowledge_social_leads", "google_review_url", "facebook_review_url", "other_review_url", "offline_payment_instructions", "proposal_default_validity_days", "invoice_default_due_days", "brand_line", "proposal_acceptance_wording", "proposal_default_intro", "proposal_default_next_steps", "proposal_default_terms", "invoice_default_payment_terms", "invoice_default_notes", "default_setup_buffer_minutes", "default_breakdown_buffer_minutes"];

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Business settings</p>
          <h1>Settings</h1>
        </div>
        <div className="button-row"><button disabled={busy} onClick={()=>{setForm({...settings});setError('');setNotice('Unsaved changes reverted.');}}>Revert changes</button><button className="primary-action" onClick={save} disabled={busy}>Save Changes</button></div>
      </div>
      {(notice || error) && <div role={error?"alert":"status"} className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <section className="panel" id="integrations"><h2>Integration preferences</h2><p><a href="/system/data-review">Review business and test-data classifications</a></p><p>Email is the primary channel. Payment checkout is test-only. Credentials are configured securely on the server.</p><div className="form-grid"><label>Enable Stripe test checkout<input type="checkbox" checked={Boolean(form.stripe_enabled)} onChange={e=>setForm({...form,stripe_enabled:e.target.checked})}/></label>{['event_24h','overdue_balance','urgent_operations'].map(rule=><label key={rule}>SMS escalation · {labelize(rule)}<input type="checkbox" checked={Boolean(form.sms_escalations?.[rule])} onChange={e=>setForm({...form,sms_escalations:{...form.sms_escalations,[rule]:e.target.checked}})}/></label>)}<label>Balance overdue days before SMS<input type="number" min="1" max="90" value={form.sms_escalations?.overdue_days||7} onChange={e=>setForm({...form,sms_escalations:{...form.sms_escalations,overdue_days:Number(e.target.value)}})}/></label><label>Hours after successful email before SMS<input type="number" min="0" max="168" value={form.sms_escalations?.email_delay_hours??1} onChange={e=>setForm({...form,sms_escalations:{...form.sms_escalations,email_delay_hours:Number(e.target.value)}})}/></label></div><p><a href="/system/integrations">View SMS provider state and send counts</a>. Consent is always required and cannot be disabled.</p><p>SMS additionally requires a ready provider, current recorded consent and qualifying timing. Marketing adapters are disabled by default. Server environment controls external dispatch; review configuration and payload tests in Integrations.</p></section>
      <section className="brand-settings-preview">
        <div>
          <p className="eyebrow">Branding</p>
          <h2>LOLA document system</h2>
          <p className="note-text">Default approved assets are mapped for admin chrome, proposals, invoices, receipts, email headers, public pages, and the favicon.</p>
        </div>
        <div className="brand-asset-row">
          <img src="/brand/LOLA_Horizontal_Dark_Transparent.png" alt="Horizontal dark LOLA logo" />
          <img src="/brand/LOLA_Primary_Dark_Transparent.png" alt="Primary dark LOLA logo" />
          <img src="/brand/LOLA_LB_Monogram_Gold.png" alt="Gold LB monogram" />
        </div>
        <div className="brand-swatches" aria-label="LOLA brand colors">
          <span style={{ background: "#FAF7F1" }}>Ivory</span>
          <span style={{ background: "#D9C6A8" }}>Champagne</span>
          <span style={{ background: "#B89B6B", color: "#fff" }}>Gold</span>
          <span style={{ background: "#1A1A1A", color: "#fff" }}>Charcoal</span>
          <span style={{ background: "#E8DDD0" }}>Taupe</span>
        </div>
      </section>
      <p className="note-text">Changes apply only when saved. The canonical public email is info@thelolabooth.com unless an approved business override is supplied.</p>
      {['Business','Brand','Documents','Email','Operations','Website','System'].map(group=><details className="panel" open={group==='Business'} key={group}><summary>{group}</summary><div className="settings-grid">{fields.filter(field=>settingGroup(field)===group).map(field=><label key={field}>{labelize(field)}<SettingInput field={field} value={form[field]} onChange={value=>setForm(current=>({...current,[field]:value}))}/></label>)}</div></details>)}
      {notificationPrefs && (
        <section className="notification-settings panel">
          <div className="table-heading">
            <div>
              <p className="eyebrow">Profile</p>
              <h2>Notifications</h2>
            </div>
            <button className="primary-action" onClick={() => saveNotificationPrefs()}>Save Notifications</button>
          </div>
          <div className="preference-toggles">
            <label className="check-row"><input type="checkbox" checked={notificationPrefs.in_app_enabled !== false} onChange={(event) => setNotificationPrefs((current) => ({ ...current, in_app_enabled: event.target.checked }))} />In-app notifications</label>
            <label className="check-row"><input type="checkbox" checked={notificationPrefs.email_enabled !== false} onChange={(event) => setNotificationPrefs((current) => ({ ...current, email_enabled: event.target.checked }))} />Email notifications</label>
            <label className="check-row"><input type="checkbox" checked={notificationPrefs.sms_enabled === true} disabled />SMS notifications (deferred)</label>
            <label className="check-row disabled"><input type="checkbox" checked disabled />Critical alerts mandatory</label>
          </div>
          <div className="category-grid">
            {["LEADS", "EVENTS", "STAFF", "EQUIPMENT", "PAYMENTS", "SYSTEM", "INCIDENTS", "SALES"].map((category) => (
              <label className="check-row" key={category}>
                <input type="checkbox" checked={(notificationPrefs.categories || {})[category] !== false} onChange={(event) => updateCategory(category, event.target.checked)} />
                {category.toLowerCase().replaceAll("_", " ")}
              </label>
            ))}
          </div>
          <p className="note-text">Critical incidents, security alerts, and payment integration failures remain mandatory in-app alerts even when a category is muted.</p>
        </section>
      )}
    </main>
  );
}

function settingGroup(field){if(/brand/.test(field))return 'Brand';if(/email|acknowledge/.test(field)&&field!=='business_email')return 'Email';if(/website|review_url/.test(field))return 'Website';if(/proposal|invoice|deposit|payment|tax|currency|balance/.test(field))return 'Documents';if(/equipment|staff|warning|buffer|delivery|assignment/.test(field))return 'Operations';if(/timezone|week_start/.test(field))return 'System';return 'Business';}
function SettingInput({field,value,onChange}){
 const enums={lead_assignment_mode:['MANUAL','ROUND_ROBIN','SPECIFIC_USER','BY_SOURCE'],default_deposit_type:['PERCENTAGE','FIXED'],booking_confirmation_policy:['MANUAL','PROPOSAL_ACCEPTED','DEPOSIT_PAID','FULL_PAYMENT']};
 if(field==='business_week_start')return <select value={value??1} onChange={e=>onChange(Number(e.target.value))}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,i)=><option key={day} value={i}>{day}</option>)}</select>;
 if(field==='lead_assignment_user_id')return <RelationshipSelect resource="users" value={value} placeholder="Lead owner" onChange={onChange}/>;
 if(field.startsWith('auto_acknowledge'))return <input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked)}/>;
 if(enums[field])return <select value={value||''} onChange={e=>onChange(e.target.value)}><option value="">Select…</option>{[...new Set([value,...enums[field]].filter(Boolean))].map(v=><option key={v}>{v}</option>)}</select>;
 if(/terms|notes|intro|wording|instructions|next_steps|address/.test(field))return <textarea value={value||''} onChange={e=>onChange(e.target.value)}/>;
 const type=/email/.test(field)?'email':/url|website/.test(field)?'url':/phone/.test(field)?'tel':/days|minutes|hours|percent|number|deposit_value/.test(field)?'number':'text';
 return <input type={type} step={type==='number'?'any':undefined} value={value??''} onChange={e=>onChange(e.target.value)}/>;
}
