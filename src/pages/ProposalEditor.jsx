import { ArrowDown, ArrowLeft, ArrowUp, FileUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import RelationshipSelect from "../components/RelationshipSelect.jsx";

const corporateSections = [
  "Campaign Objectives", "Brand Experience Concept", "Guest Journey", "Deliverables",
  "Branding Opportunities", "Content Capture", "Lead / Data Capture", "Staffing",
  "Production Requirements", "Custom Backdrop / Set Design", "Digital Gallery / Microsite",
  "Social Sharing", "Analytics / Reporting", "Travel / Logistics", "Timeline", "Custom Notes"
];

export default function ProposalEditor() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [loaded, setLoaded] = useState(!id);
  const [params] = useSearchParams();
  const [mode, setMode] = useState("create");
  const [addon, setAddon] = useState({ addon_id: "", quantity: 1 });
  const [customLine, setCustomLine] = useState({ description: "", detail: "", quantity: 1, unit_price: "" });
  const [upload, setUpload] = useState({ filename: "", pdf_base64: "" });
  const [form, setForm] = useState({
    lead_id: params.get("leadId") || "",
    client_id: params.get("clientId") || "",
    event_id: params.get("eventId") || "",
    proposal_title: "Custom Experience Proposal",
    proposal_date: new Date().toISOString().slice(0, 10),
    package_id: "",
    experience_id: "",
    status: "DRAFT",
    deposit_type: "PERCENTAGE",
    deposit_value: 30,
    addons: [],
    custom_line_items: [],
    sections: ["Introduction", "Event Details", "Proposed Experience", "Package Includes", "Investment Summary", "Next Steps", "Terms"].map((title, index) => section(title, index))
  });
  const [error, setError] = useState("");

  useEffect(() => { if (id) api.get(`/proposals/${id}`).then(proposal => { setForm(proposal.editable_input); setLoaded(true); }).catch(err => setError(err.message)); }, [id]);

  useEffect(() => {
    if (form.event_id && !form.client_id) {
      api.get(`/events/${form.event_id}`).then((event) => {
        setForm((current) => ({ ...current, client_id: event.client_id || current.client_id, package_id: event.package_id || current.package_id, experience_id: event.experience_id || current.experience_id }));
      }).catch(() => {});
    }
  }, [form.event_id]);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateSection(index, patch) {
    setForm((current) => ({ ...current, sections: current.sections.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  }

  function moveSection(index, direction) {
    setForm((current) => {
      const next = [...current.sections];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, sections: next.map((item, display_order) => ({ ...item, display_order })) };
    });
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUpload({ filename: file.name, pdf_base64: await toBase64(file) });
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    try {
      const payload = compact({ ...form, ...upload, total_investment: form.package_amount });
      const created = id ? await api.patch(`/proposals/${id}`, payload) : mode === "upload" ? await api.post("/proposals/upload", payload) : await api.post("/proposals", payload);
      navigate(`/sales/proposals/${created.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="detail-back"><Link to="/sales/proposals"><ArrowLeft size={16} />Back to proposals</Link></div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Proposal builder</p>
          <h1>{id ? "Edit Proposal" : "New Proposal"}</h1>
        </div>
        <div className="segmented" hidden={Boolean(id)}>
          <button type="button" className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>Create in LOLA</button>
          <button type="button" className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}>Upload External Proposal</button>
        </div>
      </div>
      {error && <div className="toast error">{error}</div>}
      <form className="document-editor" onSubmit={save}>
        <section className="panel">
          <h2>Proposal</h2>
          <div className="form-grid">
            <label>Lead<RelationshipSelect resource="leads" value={form.lead_id} placeholder="Lead" onChange={(value) => setField("lead_id", value)} /></label>
            <label>Client<RelationshipSelect resource="clients" value={form.client_id} placeholder="Client" onChange={(value) => setField("client_id", value)} /></label>
            <label>Event<RelationshipSelect resource="events" value={form.event_id} placeholder="Event" onChange={(value) => setField("event_id", value)} /></label>
            <label>Proposal title<input value={form.proposal_title || ""} onChange={(event) => setField("proposal_title", event.target.value)} /></label>
            <label>Proposal date<input type="date" value={form.proposal_date || ""} onChange={(event) => setField("proposal_date", event.target.value)} /></label>
            <label>Expiration date<input type="date" value={form.valid_through || ""} onChange={(event) => setField("valid_through", event.target.value)} /></label>
            <label>Status<select value={form.status} onChange={(event) => setField("status", event.target.value)}>{["DRAFT", "READY"].map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
        </section>

        {mode === "upload" && (
          <section className="panel">
            <h2>Uploaded proposal PDF</h2>
            <label className="file-drop"><FileUp size={18} />Upload customer-facing PDF<input type="file" accept="application/pdf" onChange={chooseFile} /></label>
            {upload.filename && <p className="lede">Selected: {upload.filename}</p>}
          </section>
        )}

        {mode === "create" && (
          <>
            <section className="panel">
              <h2>Services / Pricing</h2>
              <div className="form-grid">
                <label>Package<RelationshipSelect resource="packages" value={form.package_id} placeholder="Package" onChange={(value) => setField("package_id", value)} /></label>
                <label>Experience<RelationshipSelect resource="experiences" value={form.experience_id} placeholder="Experience" onChange={(value) => setField("experience_id", value)} /></label>
                <label>Package amount<input type="number" value={form.package_amount || ""} onChange={(event) => setField("package_amount", event.target.value)} /></label>
                <label>Experience surcharge<input type="number" value={form.experience_surcharge || ""} onChange={(event) => setField("experience_surcharge", event.target.value)} /></label>
                <label>Travel<input type="number" value={form.travel || ""} onChange={(event) => setField("travel", event.target.value)} /></label>
                <label>Other fees<input type="number" value={form.other_fees || ""} onChange={(event) => setField("other_fees", event.target.value)} /></label>
                <label>Discount<input type="number" value={form.discount || ""} onChange={(event) => setField("discount", event.target.value)} /></label>
                <label>Tax rate<input type="number" value={form.tax_rate || ""} onChange={(event) => setField("tax_rate", event.target.value)} /></label>
                <label>Deposit type<select value={form.deposit_type} onChange={(event) => setField("deposit_type", event.target.value)}><option>PERCENTAGE</option><option>FIXED</option></select></label>
                <label>Deposit value<input type="number" value={form.deposit_value || ""} onChange={(event) => setField("deposit_value", event.target.value)} /></label>
              </div>
              <div className="inline-form">
                <RelationshipSelect resource="addons" value={addon.addon_id} placeholder="Add-on" onChange={(value) => setAddon((current) => ({ ...current, addon_id: value }))} />
                <input type="number" min="1" value={addon.quantity} onChange={(event) => setAddon((current) => ({ ...current, quantity: event.target.value }))} />
                <button type="button" className="primary-action" disabled={!addon.addon_id} onClick={() => { setForm((current) => ({ ...current, addons: [...current.addons, addon] })); setAddon({ addon_id: "", quantity: 1 }); }}><Plus size={16} />Add</button>
              </div>
              <div className="line-list">{form.addons.map((item, index) => <div key={`${item.addon_id}-${index}`}><span>Add-on {index + 1} · Qty {item.quantity}</span><button type="button" onClick={() => setForm((current) => ({ ...current, addons: current.addons.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></div>)}</div>
              <div className="inline-form custom-line-form">
                <input placeholder="Custom service" value={customLine.description} onChange={(event) => setCustomLine((current) => ({ ...current, description: event.target.value }))} />
                <input placeholder="Description" value={customLine.detail} onChange={(event) => setCustomLine((current) => ({ ...current, detail: event.target.value }))} />
                <input type="number" min="1" value={customLine.quantity} onChange={(event) => setCustomLine((current) => ({ ...current, quantity: event.target.value }))} />
                <input type="number" placeholder="Rate" value={customLine.unit_price} onChange={(event) => setCustomLine((current) => ({ ...current, unit_price: event.target.value }))} />
                <button type="button" className="primary-action" disabled={!customLine.description} onClick={() => { setForm((current) => ({ ...current, custom_line_items: [...current.custom_line_items, customLine] })); setCustomLine({ description: "", detail: "", quantity: 1, unit_price: "" }); }}><Plus size={16} />Service</button>
              </div>
              <div className="line-list">{form.custom_line_items.map((item, index) => <div key={`${item.description}-${index}`}><span>{item.description} · Qty {item.quantity} · ${item.unit_price || 0}</span><button type="button" onClick={() => setForm((current) => ({ ...current, custom_line_items: current.custom_line_items.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></div>)}</div>
            </section>

            <section className="panel">
              <h2>Content Sections</h2>
              <div className="section-pills">
                {corporateSections.map((title) => <button type="button" key={title} onClick={() => setForm((current) => ({ ...current, sections: [...current.sections, section(title, current.sections.length)] }))}><Plus size={13} />{title}</button>)}
              </div>
              <button type="button" onClick={() => setForm((current) => ({ ...current, sections: [...current.sections, section("Custom Section", current.sections.length)] }))}><Plus size={15} />Add Custom Section</button>
              <div className="proposal-sections">
                {form.sections.map((item, index) => (
                  <article className="proposal-section-editor" key={`${item.id}-${index}`}>
                    <div className="section-toolbar">
                      <input value={item.title} onChange={(event) => updateSection(index, { title: event.target.value })} />
                      <button type="button" aria-label="Move section up" onClick={() => moveSection(index, -1)}><ArrowUp size={14} /></button>
                      <button type="button" aria-label="Move section down" onClick={() => moveSection(index, 1)}><ArrowDown size={14} /></button>
                      <button type="button" aria-label="Remove section" onClick={() => setForm((current) => ({ ...current, sections: current.sections.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button>
                    </div>
                    <textarea value={item.body} onChange={(event) => updateSection(index, { body: event.target.value })} placeholder="Section body" />
                    <textarea className="compact-textarea" value={(item.items || []).join("\n")} onChange={(event) => updateSection(index, { items: event.target.value.split("\n").filter(Boolean) })} placeholder="Optional bullets, one per line" />
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="panel">
          <h2>Terms / Notes</h2>
          <div className="form-grid">
            <label className="wide">Next steps<textarea value={form.next_steps || ""} onChange={(event) => setField("next_steps", event.target.value)} /></label>
            <label className="wide">Terms<textarea value={form.terms || ""} onChange={(event) => setField("terms", event.target.value)} /></label>
            <label className="wide">Internal notes<textarea value={form.notes || ""} onChange={(event) => setField("notes", event.target.value)} /></label>
          </div>
        </section>
        <div className="modal-actions"><Link to="/sales/proposals">Cancel</Link><button className="primary-action" disabled={!loaded}>{id ? "Save Proposal" : mode === "upload" ? "Upload Proposal" : "Create Proposal"}</button></div>
      </form>
    </main>
  );
}

function section(title, display_order = 0) {
  return { id: title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), title, body: "", items: [], display_order };
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === "" ? null : item]));
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
