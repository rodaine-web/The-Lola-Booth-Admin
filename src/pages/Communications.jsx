import { Eye, Play, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

export default function Communications() {
  const [templates, setTemplates] = useState(null);
  const [automations, setAutomations] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setError("");
    try {
      const [templateData, automationData] = await Promise.all([
        api.get("/communications/templates"),
        api.get("/communications/automations")
      ]);
      setTemplates(templateData);
      setAutomations(automationData);
    } catch (err) {
      setError(err.message);
    }
  }

  async function previewTemplate(id) {
    setError("");
    try {
      setPreview(await api.post(`/communications/templates/${id}/preview`, {}));
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleAutomation(row) {
    setError("");
    setNotice("");
    try {
      await api.patch(`/communications/automations/${row.id}`, { enabled: !row.enabled });
      setNotice(`${row.name} ${row.enabled ? "disabled" : "enabled"}.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function processJobs() {
    setError("");
    setNotice("");
    try {
      const result = await api.post("/communications/jobs/process", {});
      setNotice(`${result.processed?.length || 0} job(s) processed.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!templates || !automations) return <main className="page"><div className="empty-state">Loading communications...</div></main>;

  return (
    <main className="page">
      <div className="page-heading">
        <div><p className="eyebrow">Sales</p><h1>Communications</h1></div>
        <div className="button-row">
          <button onClick={load}><RefreshCw size={16} />Refresh</button>
          <button className="primary-action" onClick={processJobs}><Play size={16} />Process Due Jobs</button>
        </div>
      </div>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}

      <section className="dashboard-grid">
        <article className="panel">
          <h2>Email Templates</h2>
          <div className="template-list">
            {templates.data.map((template) => (
              <button key={template.id} className="template-row" onClick={() => previewTemplate(template.id)}>
                <span>{template.name}</span>
                <small>{template.template_key} · {template.category}</small>
                <Eye size={15} />
              </button>
            ))}
          </div>
        </article>
        <article className="panel email-preview">
          <h2>Template Preview</h2>
          {preview ? (
            <>
              <Field label="Subject" value={preview.subject} />
              <div className="email-body-preview">{preview.body}</div>
            </>
          ) : <div className="empty-state">Select a template to preview sample LOLA data.</div>}
        </article>
      </section>

      <section className="panel">
        <div className="table-heading"><h2>Automations</h2></div>
        <div className="automation-list">
          {automations.data.map((row) => (
            <article className="automation-row" key={row.id}>
              <button aria-label={row.enabled ? "Disable automation" : "Enable automation"} onClick={() => toggleAutomation(row)}>
                {row.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
              </button>
              <div>
                <strong>{row.name}</strong>
                <span>{row.trigger_key.replaceAll("_", " ")} · {row.delay_amount} {row.delay_unit.toLowerCase()} · {row.action_type.replaceAll("_", " ")}</span>
              </div>
              <small>{row.last_run_at ? new Date(row.last_run_at).toLocaleString() : "No runs yet"}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <h2>Jobs</h2>
          <DataTable rows={automations.jobs} columns={["job_type", "related_entity_type", "scheduled_for", "status", "attempt_count", "last_error"]} empty="No automation jobs yet." />
        </article>
        <article className="panel">
          <h2>History</h2>
          <DataTable rows={automations.runs} columns={["automation_name", "entity_type", "scheduled_for", "executed_at", "result", "error"]} empty="No automation runs yet." />
        </article>
      </section>
    </main>
  );
}

function Field({ label, value }) {
  return <div className="field-row"><span>{label}</span><strong>{value || "—"}</strong></div>;
}
