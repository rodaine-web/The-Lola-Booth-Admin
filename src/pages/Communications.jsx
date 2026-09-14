import { Archive, CheckCircle2, Clock, Copy, Edit3, Eye, Mail, Play, RefreshCw, Save, Search, Send, ToggleLeft, ToggleRight, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

const templateTabs = ["All", "Email", "SMS", "Proposal", "Invoice", "Document", "Internal"];
const communicationTabs = ["SENT_TO_PROVIDER", "DRAFT", "SCHEDULED", "FAILED", "ALL"];
const blankTemplate = {
  name: "",
  key: "",
  template_type: "EMAIL",
  channel: "EMAIL",
  category: "SALES",
  status: "DRAFT",
  subject_template: "",
  body_template: "",
  text_template: "",
  default_send_mode: "REVIEW_BEFORE_SEND",
  description: ""
};

export default function Communications() {
  const [section, setSection] = useState("Communications");
  const [templateTab, setTemplateTab] = useState("All");
  const [communicationTab, setCommunicationTab] = useState("SENT_TO_PROVIDER");
  const [templates, setTemplates] = useState(null);
  const [automations, setAutomations] = useState(null);
  const [communications, setCommunications] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedCommunication, setSelectedCommunication] = useState(null);
  const [editor, setEditor] = useState(blankTemplate);
  const [preview, setPreview] = useState(null);
  const [variableSearch, setVariableSearch] = useState("");
  const [activeField, setActiveField] = useState("body_template");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const bodyRef = useRef(null);
  const subjectRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (templates) loadCommunications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communicationTab]);

  async function load() {
    setError("");
    try {
      const [templateData, automationData] = await Promise.all([
        api.get("/communications/templates"),
        api.get("/communications/automations")
      ]);
      setTemplates(templateData);
      setAutomations(automationData);
      await loadCommunications();
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadCommunications() {
    const status = communicationTab === "ALL" ? "" : `?status=${communicationTab}`;
    setCommunications(await api.get(`/communications${status}`));
  }

  const filteredTemplates = useMemo(() => {
    const rows = templates?.data || [];
    if (templateTab === "All") return rows;
    if (templateTab === "Internal") return rows.filter((row) => row.channel === "INTERNAL" || row.template_type === "INTERNAL_NOTIFICATION");
    return rows.filter((row) => [row.channel, row.template_type].includes(templateTab.toUpperCase()));
  }, [templates, templateTab]);

  const variables = useMemo(() => {
    const term = variableSearch.toLowerCase();
    return (templates?.variableCatalog || []).map((group) => ({
      ...group,
      variables: group.variables.filter((variable) => variable.toLowerCase().includes(term) || group.category.toLowerCase().includes(term))
    })).filter((group) => group.variables.length);
  }, [templates, variableSearch]);

  function editTemplate(template = blankTemplate) {
    setSelectedTemplate(template.id ? template : null);
    setEditor({ ...blankTemplate, ...template, key: template.key || template.template_key || "" });
    setPreview(null);
    setSection("Templates");
  }

  async function saveTemplate() {
    setError("");
    setNotice("");
    try {
      const saved = selectedTemplate?.id
        ? await api.patch(`/communications/templates/${selectedTemplate.id}`, editor)
        : await api.post("/communications/templates", editor);
      setSelectedTemplate(saved);
      setNotice("Template saved.");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function previewTemplate(templateId = selectedTemplate?.id) {
    if (!templateId) return;
    setError("");
    try {
      setPreview(await api.post(`/communications/templates/${templateId}/preview`, {}));
    } catch (err) {
      setError(err.message);
    }
  }

  async function templateAction(template, action) {
    setError("");
    setNotice("");
    try {
      if (action === "duplicate") await api.post(`/communications/templates/${template.id}/duplicate`, {});
      if (action === "activate") await api.post(`/communications/templates/${template.id}/activate`, {});
      if (action === "archive") await api.post(`/communications/templates/${template.id}/archive`, {});
      setNotice(`Template ${action}d.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function insertVariable(variable) {
    const token = `{{${variable}}}`;
    const ref = activeField === "subject_template" ? subjectRef : activeField === "text_template" ? textRef : bodyRef;
    const input = ref.current;
    const current = editor[activeField] || "";
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    setEditor((draft) => ({ ...draft, [activeField]: `${current.slice(0, start)}${token}${current.slice(end)}` }));
    requestAnimationFrame(() => input?.focus());
  }

  async function openCommunication(row) {
    setError("");
    try {
      setSelectedCommunication(await api.get(`/communications/${row.id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function communicationAction(action) {
    if (!selectedCommunication) return;
    setError("");
    setNotice("");
    try {
      if (["DRAFT", "SCHEDULED", "FAILED"].includes(selectedCommunication.status)) {
        await api.patch(`/communications/${selectedCommunication.id}`, selectedCommunication);
      }
      const result = action === "send"
        ? await api.post(`/communications/${selectedCommunication.id}/send`, {})
        : action === "cancel"
          ? await api.post(`/communications/${selectedCommunication.id}/cancel`, {})
          : await api.post(`/communications/${selectedCommunication.id}/schedule`, { scheduled_at: selectedCommunication.scheduled_at });
      setSelectedCommunication(result.communication || result);
      setNotice(`Communication ${action === "send" ? "sent" : action + "d"}.`);
      await loadCommunications();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleAutomation(row) {
    setError("");
    setNotice("");
    try {
      await api.patch(`/communications/automations/${row.id}`, { enabled: !row.enabled });
      setNotice(`${row.name} ${row.enabled ? "paused" : "activated"}.`);
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

  if (!templates || !automations || !communications) return <main className="page"><div className="empty-state">Loading communications...</div></main>;

  return (
    <main className="page">
      <div className="page-heading">
        <div><p className="eyebrow">Admin</p><h1>Communications</h1></div>
        <div className="button-row">
          <button onClick={load}><RefreshCw size={16} />Refresh</button>
          <button className="primary-action" onClick={processJobs}><Play size={16} />Process Due Jobs</button>
        </div>
      </div>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}

      <div className="segmented-control page-tabs">
        {["Communications", "Templates", "Automations"].map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item}</button>)}
      </div>

      {section === "Communications" && (
        <>
          <section className="panel">
            <div className="table-heading">
              <h2>Communication Center</h2>
              <div className="segmented-control">
                {communicationTabs.map((tab) => <button key={tab} className={communicationTab === tab ? "active" : ""} onClick={() => setCommunicationTab(tab)}>{tab.toLowerCase()}</button>)}
              </div>
            </div>
            <DataTable rows={communications.data || []} columns={["status", "channel", "recipient", "rendered_subject", "template_name", "scheduled_at", "sent_at", "failure_message"]} empty="No communications match this view." onEdit={openCommunication} />
          </section>
          {selectedCommunication && <CommunicationComposer communication={selectedCommunication} setCommunication={setSelectedCommunication} onAction={communicationAction} />}
        </>
      )}

      {section === "Templates" && (
        <section className="template-admin-grid">
          <article className="panel">
            <div className="table-heading">
              <h2>Email Templates</h2>
              <button className="primary-action" onClick={() => editTemplate()}><Edit3 size={15} />New</button>
            </div>
            <div className="segmented-control">
              {templateTabs.map((tab) => <button key={tab} className={templateTab === tab ? "active" : ""} onClick={() => setTemplateTab(tab)}>{tab}</button>)}
            </div>
            <div className="template-table">
              {filteredTemplates.map((template) => (
                <div className="template-admin-row" key={template.id}>
                  <strong>{template.name}</strong>
                  <span>{template.key || template.template_key}</span>
                  <span>{template.template_type || template.channel}</span>
                  <span>{template.status || (template.active ? "ACTIVE" : "DRAFT")}</span>
                  <span>{template.default_send_mode || "SEND_NOW"}</span>
                  <span>v{template.version || 1}</span>
                  <span>{template.updated_at ? new Date(template.updated_at).toLocaleDateString() : "New"}</span>
                  <div className="icon-actions">
                    <button title="Edit" onClick={() => editTemplate(template)}><Edit3 size={15} /></button>
                    <button title="Preview" onClick={() => { editTemplate(template); previewTemplate(template.id); }}><Eye size={15} /></button>
                    <button title="Duplicate" onClick={() => templateAction(template, "duplicate")}><Copy size={15} /></button>
                    <button title="Activate" onClick={() => templateAction(template, "activate")}><CheckCircle2 size={15} /></button>
                    <button title="Archive" onClick={() => templateAction(template, "archive")}><Archive size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          </article>
          <TemplateEditor
            editor={editor}
            setEditor={setEditor}
            selectedTemplate={selectedTemplate}
            preview={preview}
            saveTemplate={saveTemplate}
            previewTemplate={previewTemplate}
            variables={variables}
            variableSearch={variableSearch}
            setVariableSearch={setVariableSearch}
            insertVariable={insertVariable}
            setActiveField={setActiveField}
            refs={{ subjectRef, bodyRef, textRef }}
          />
        </section>
      )}

      {section === "Automations" && (
        <>
          <section className="panel">
            <div className="table-heading"><h2>Automations</h2></div>
            <div className="automation-list">
              {automations.data.map((row) => (
                <article className="automation-row" key={row.id}>
                  <button aria-label={row.enabled ? "Pause automation" : "Activate automation"} onClick={() => toggleAutomation(row)}>
                    {row.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                  </button>
                  <div>
                    <strong>{row.name}</strong>
                    <span>{row.trigger_key.replaceAll("_", " ")} · {row.action_type.replaceAll("_", " ")} · {row.action_config?.template_key || "No template"} · {row.action_config?.send_mode || "template default"}</span>
                  </div>
                  <small>{row.last_run_at ? new Date(row.last_run_at).toLocaleString() : "No runs yet"}</small>
                </article>
              ))}
            </div>
          </section>
          <section className="dashboard-grid">
            <article className="panel"><h2>Jobs</h2><DataTable rows={automations.jobs} columns={["job_type", "related_entity_type", "scheduled_for", "status", "attempt_count", "last_error"]} empty="No automation jobs yet." /></article>
            <article className="panel"><h2>History</h2><DataTable rows={automations.runs} columns={["automation_name", "entity_type", "scheduled_for", "executed_at", "result", "error"]} empty="No automation runs yet." /></article>
          </section>
        </>
      )}
    </main>
  );
}

function TemplateEditor({ editor, setEditor, selectedTemplate, preview, saveTemplate, previewTemplate, variables, variableSearch, setVariableSearch, insertVariable, setActiveField, refs }) {
  const fields = (key) => ({ value: editor[key] || "", onFocus: () => setActiveField(key), onChange: (event) => setEditor((draft) => ({ ...draft, [key]: event.target.value })) });
  return (
    <article className="panel template-editor">
      <div className="table-heading"><h2>Template Editor</h2><button className="primary-action" onClick={saveTemplate}><Save size={15} />Save</button></div>
      <div className="editor-grid">
        <label>Name<input value={editor.name || ""} onChange={(e) => setEditor((d) => ({ ...d, name: e.target.value }))} /></label>
        <label>Key<input value={editor.key || ""} onChange={(e) => setEditor((d) => ({ ...d, key: e.target.value, template_key: e.target.value }))} /></label>
        <label>Type<select value={editor.template_type || "EMAIL"} onChange={(e) => setEditor((d) => ({ ...d, template_type: e.target.value }))}>{["EMAIL", "SMS", "PROPOSAL", "INVOICE", "DOCUMENT", "INTERNAL_NOTIFICATION"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Category<input value={editor.category || ""} onChange={(e) => setEditor((d) => ({ ...d, category: e.target.value }))} /></label>
        <label>Status<select value={editor.status || "DRAFT"} onChange={(e) => setEditor((d) => ({ ...d, status: e.target.value, active: e.target.value === "ACTIVE" }))}>{["DRAFT", "ACTIVE", "ARCHIVED"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Default Send Mode<select value={editor.default_send_mode || "REVIEW_BEFORE_SEND"} onChange={(e) => setEditor((d) => ({ ...d, default_send_mode: e.target.value }))}>{["AUTOMATIC", "REVIEW_BEFORE_SEND", "MANUAL", "SCHEDULED", "SEND_NOW", "CREATE_DRAFT"].map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <label>Subject<input ref={refs.subjectRef} {...fields("subject_template")} /></label>
      <label>Rich body<textarea ref={refs.bodyRef} rows={10} {...fields("body_template")} /></label>
      <label>Plain-text body<textarea ref={refs.textRef} rows={5} {...fields("text_template")} /></label>
      <label>Description<textarea rows={3} value={editor.description || ""} onChange={(e) => setEditor((d) => ({ ...d, description: e.target.value }))} /></label>
      <div className="template-meta">
        <span>Version v{editor.version || 1}</span>
        <span>Created By {editor.created_by || "system"}</span>
        <span>Updated By {editor.updated_by || "system"}</span>
        <span>Last Updated {editor.updated_at ? new Date(editor.updated_at).toLocaleString() : "Not saved"}</span>
      </div>
      <div className="button-row"><button disabled={!selectedTemplate?.id} onClick={() => previewTemplate()}><Eye size={15} />Preview With Sample Data</button></div>
      {preview && <div className="preview-stack"><Field label="Subject" value={preview.subject} /><div className="email-body-preview">{preview.body}</div><Field label="Plain Text" value={preview.text} />{preview.unresolvedVariables?.length ? <p className="error-text">Unresolved: {preview.unresolvedVariables.join(", ")}</p> : <p className="ok-text">All required variables resolved.</p>}</div>}
      <div className="variable-picker">
        <label><Search size={15} />Available Variables<input value={variableSearch} onChange={(e) => setVariableSearch(e.target.value)} placeholder="Search variables" /></label>
        {variables.map((group) => <div key={group.category}><strong>{group.category}</strong><div className="variable-chip-row">{group.variables.map((variable) => <button key={variable} onClick={() => insertVariable(variable)}>{variable}</button>)}</div></div>)}
      </div>
    </article>
  );
}

function CommunicationComposer({ communication, setCommunication, onAction }) {
  const immutable = !["DRAFT", "SCHEDULED", "FAILED"].includes(communication.status);
  return (
    <section className="panel composer-panel">
      <div className="table-heading"><h2>Composer</h2><span className="status-pill">{communication.status}</span></div>
      <div className="editor-grid">
        <Field label="Channel" value={communication.channel} />
        <Field label="Template" value={communication.template_name || communication.template_key} />
        <Field label="Client" value={communication.client_name || communication.client_id} />
        <Field label="Event" value={communication.event_name || communication.event_id} />
        <Field label="Proposal" value={communication.proposal_number || communication.proposal_id} />
        <Field label="Invoice" value={communication.invoice_number || communication.invoice_id} />
      </div>
      <label>Recipient<input disabled={immutable} value={communication.recipient || ""} onChange={(e) => setCommunication((row) => ({ ...row, recipient: e.target.value }))} /></label>
      <label>Subject<input disabled={immutable} value={communication.rendered_subject || communication.subject || ""} onChange={(e) => setCommunication((row) => ({ ...row, rendered_subject: e.target.value, subject: e.target.value }))} /></label>
      <label>Body<textarea disabled={immutable} rows={8} value={communication.rendered_body || ""} onChange={(e) => setCommunication((row) => ({ ...row, rendered_body: e.target.value }))} /></label>
      {communication.channel === "SMS" && <p className="muted">{(communication.rendered_body || "").length} characters</p>}
      {!immutable && <label>Schedule<input type="datetime-local" value={(communication.scheduled_at || "").slice(0, 16)} onChange={(e) => setCommunication((row) => ({ ...row, scheduled_at: e.target.value }))} /></label>}
      <div className="button-row">
        <button disabled={immutable} onClick={() => onAction("cancel")}><XCircle size={15} />Cancel</button>
        <button disabled={immutable || !communication.scheduled_at} onClick={() => onAction("schedule")}><Clock size={15} />Schedule</button>
        <button className="primary-action" disabled={immutable} onClick={() => onAction("send")}><Send size={15} />Send Now</button>
      </div>
    </section>
  );
}

function Field({ label, value }) {
  return <div className="field-row"><span>{label}</span><strong>{value || "-"}</strong></div>;
}
