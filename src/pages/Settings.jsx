import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [notificationPrefs, setNotificationPrefs] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/settings").then((result) => {
      setSettings(result);
      setForm(result);
    });
    api.get("/notifications/preferences").then(setNotificationPrefs).catch(() => null);
  }, []);

  async function save() {
    setNotice("");
    setError("");
    try {
      const updated = await api.patch("/settings", form);
      setSettings(updated);
      setForm(updated);
      setNotice("Settings saved.");
    } catch (err) {
      setError(err.message);
    }
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

  if (!settings) return <main className="page"><div className="empty-state">Loading settings...</div></main>;

  const fields = ["business_name", "legal_business_name", "business_email", "phone", "website", "service_area", "address", "timezone", "business_week_start", "currency", "sales_tax_percent", "default_deposit_percent", "default_balance_due_days", "invoice_prefix", "proposal_prefix", "next_invoice_number", "next_proposal_number", "booking_confirmation_policy", "default_deposit_type", "default_deposit_value", "default_balance_due_days_before_event", "default_equipment_turnaround_buffer_minutes", "default_staff_travel_buffer_minutes", "setup_warning_minutes", "event_start_warning_minutes", "equipment_return_warning_hours", "delivery_default_expiration_days", "lead_assignment_mode", "lead_assignment_user_id", "auto_acknowledge_website_leads", "auto_acknowledge_social_leads", "google_review_url", "facebook_review_url", "other_review_url", "stripe_enabled", "paypal_enabled", "offline_payment_instructions", "proposal_default_validity_days", "invoice_default_due_days", "brand_line", "proposal_acceptance_wording", "proposal_default_intro", "proposal_default_next_steps", "proposal_default_terms", "invoice_default_payment_terms", "invoice_default_notes", "default_setup_buffer_minutes", "default_breakdown_buffer_minutes"];

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Business settings</p>
          <h1>Settings</h1>
        </div>
        <button className="primary-action" onClick={save}>Save Changes</button>
      </div>
      {(notice || error) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
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
      <section className="settings-grid">
        {fields.map((field) => (
          <label key={field}>
            {field.replaceAll("_", " ")}
            {["stripe_enabled", "paypal_enabled", "auto_acknowledge_website_leads", "auto_acknowledge_social_leads"].includes(field) ? (
              <input type="checkbox" checked={Boolean(form[field])} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.checked }))} />
            ) : field.includes("default_") && !field.includes("days") && !field.includes("percent") && !field.includes("buffer") && !field.includes("deposit_value") ? (
              <textarea value={form[field] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} />
            ) : field === "offline_payment_instructions" ? (
              <textarea value={form[field] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} />
            ) : (
              <input value={form[field] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} />
            )}
          </label>
        ))}
      </section>
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
            <label className="check-row"><input type="checkbox" checked={notificationPrefs.sms_enabled === true} onChange={(event) => setNotificationPrefs((current) => ({ ...current, sms_enabled: event.target.checked }))} />SMS notifications</label>
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
