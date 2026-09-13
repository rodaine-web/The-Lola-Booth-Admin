import { AlertTriangle, CheckCircle2, FlaskConical, RefreshCw, RotateCcw, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const providerLabels = {
  META: "Meta",
  TIKTOK: "TikTok",
  LINKEDIN: "LinkedIn",
  WEBSITE: "Website",
  EMAIL_PROVIDER: "Email Provider"
};

export default function Integrations() {
  const [data, setData] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setError("");
    try {
      const [overview, payments] = await Promise.all([
        api.get("/integrations/overview"),
        api.get("/payment-providers/status")
      ]);
      setData(overview);
      setPaymentStatus(payments);
    } catch (err) {
      setError(err.message);
    }
  }

  async function testLead(provider) {
    setNotice("");
    setError("");
    try {
      const result = await api.post(`/integrations/${provider}/test-lead`, {});
      setNotice(`${providerLabels[provider] || provider} test lead ${result.action?.toLowerCase().replaceAll("_", " ")}.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function retry(id) {
    setNotice("");
    setError("");
    try {
      await api.post(`/integrations/failed-inbound/${id}/retry`, {});
      setNotice("Inbound lead retry queued.");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) return <main className="page"><div className="empty-state">Loading integrations...</div></main>;

  return (
    <main className="page">
      <div className="page-heading">
        <div><p className="eyebrow">System</p><h1>Integrations</h1></div>
        <button className="primary-action" onClick={load}><RefreshCw size={16} />Refresh</button>
      </div>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}

      <section className="integration-section">
        <div><p className="eyebrow">Lead Sources</p><h2>Social and website lead intake</h2></div>
        <div className="integration-grid">
          {data.leadSources.map((provider) => (
            <article className="panel integration-card" key={provider.provider}>
              <div className="integration-heading">
                <h2>{providerLabels[provider.provider] || provider.provider}</h2>
                <Status status={provider.status} />
              </div>
              <Field label="Account" value={provider.connected_account || provider.provider_account_id || "Not connected"} />
              <Field label="Selected forms" value={Array.isArray(provider.selected_forms) ? provider.selected_forms.length : 0} />
              <Field label="Leads received" value={provider.leads_received_count || 0} />
              <Field label="Last lead" value={formatDate(provider.last_successful_lead_at)} />
              <Field label="Last webhook" value={formatDate(provider.last_webhook_at)} />
              {provider.provider === "LINKEDIN" && provider.status === "AWAITING_APPROVAL" && (
                <p className="note-text">LinkedIn Lead Sync requires LinkedIn API approval before live syncing can be enabled.</p>
              )}
              {provider.last_error && <p className="error-text"><AlertTriangle size={14} />{provider.last_error}</p>}
              <div className="button-row">
                <button onClick={() => testLead(provider.provider)}><FlaskConical size={15} />Test Lead</button>
                <button><Settings2 size={15} />Test Mapping</button>
              </div>
              <details>
                <summary>Field maps</summary>
                <DataTable rows={provider.fieldMaps || []} columns={["provider_entity", "field_map", "updated_at"]} empty="No form mapping yet." />
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="integration-section">
        <div><p className="eyebrow">Communications</p><h2>Email provider</h2></div>
        <div className="integration-grid">
          {data.communications.map((provider) => (
            <article className="panel integration-card" key={provider.provider}>
              <div className="integration-heading"><h2>{providerLabels[provider.provider] || provider.provider}</h2><Status status={provider.status} /></div>
              <Field label="Connected account" value={provider.connected_account || "Development/test mode"} />
              <Field label="Last send/sync" value={formatDate(provider.last_successful_sync_at)} />
              <Field label="Last error" value={provider.last_error || "None"} />
            </article>
          ))}
        </div>
      </section>

      <section className="integration-section">
        <div><p className="eyebrow">Payments</p><h2>Payment integrations</h2></div>
        <div className="integration-grid">
          {paymentStatus && Object.values(paymentStatus).map((provider) => (
            <article className="panel integration-card" key={provider.provider}>
              <h2>{provider.provider}</h2>
              <Field label="Status" value={provider.configured ? "Configured" : "Missing credentials"} />
              <Field label="Mode" value={provider.mode} />
              <Field label="Webhook" value={provider.webhookConfigured ? "Configured" : "Missing"} />
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="table-heading"><h2>Failed inbound leads</h2></div>
        <DataTable rows={data.failedInbound || []} columns={["provider", "event_type", "status", "attempt_count", "last_error", "received_at"]} empty="No failed inbound leads." />
        {(data.failedInbound || []).map((item) => (
          <button key={item.id} className="inline-action" onClick={() => retry(item.id)}><RotateCcw size={14} />Retry {item.provider} event</button>
        ))}
      </section>
    </main>
  );
}

function Status({ status }) {
  const ok = status === "CONNECTED";
  return <span className={`status-pill ${status?.toLowerCase()}`}>{ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{status?.replaceAll("_", " ")}</span>;
}

function Field({ label, value }) { return <div className="field-row"><span>{label}</span><strong>{value || "—"}</strong></div>; }

function formatDate(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}
