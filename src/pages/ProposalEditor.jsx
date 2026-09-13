import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import RelationshipSelect from "../components/RelationshipSelect.jsx";

export default function ProposalEditor() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [addon, setAddon] = useState({ addon_id: "", quantity: 1 });
  const [form, setForm] = useState({
    lead_id: params.get("leadId") || "",
    client_id: params.get("clientId") || "",
    event_id: params.get("eventId") || "",
    package_id: "",
    experience_id: "",
    status: "DRAFT",
    deposit_type: "PERCENTAGE",
    deposit_value: 30,
    addons: []
  });
  const [error, setError] = useState("");

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

  async function save(event) {
    event.preventDefault();
    setError("");
    try {
      const created = await api.post("/proposals", compact(form));
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
          <p className="eyebrow">Proposal editor</p>
          <h1>New Proposal</h1>
        </div>
      </div>
      {error && <div className="toast error">{error}</div>}
      <form className="document-editor" onSubmit={save}>
        <section className="panel">
          <h2>Relationships</h2>
          <div className="form-grid">
            <label>Lead<RelationshipSelect resource="leads" value={form.lead_id} placeholder="Lead" onChange={(value) => setField("lead_id", value)} /></label>
            <label>Client<RelationshipSelect resource="clients" value={form.client_id} placeholder="Client" onChange={(value) => setField("client_id", value)} /></label>
            <label>Event<RelationshipSelect resource="events" value={form.event_id} placeholder="Event" onChange={(value) => setField("event_id", value)} /></label>
            <label>Package<RelationshipSelect resource="packages" value={form.package_id} placeholder="Package" onChange={(value) => setField("package_id", value)} /></label>
            <label>Experience<RelationshipSelect resource="experiences" value={form.experience_id} placeholder="Experience" onChange={(value) => setField("experience_id", value)} /></label>
            <label>Status<select value={form.status} onChange={(event) => setField("status", event.target.value)}>{["DRAFT", "READY"].map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
        </section>
        <section className="panel">
          <h2>Pricing</h2>
          <div className="form-grid">
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
        </section>
        <section className="panel">
          <h2>Copy</h2>
          <div className="form-grid">
            <label className="wide">Introduction<textarea value={form.introduction || ""} onChange={(event) => setField("introduction", event.target.value)} /></label>
            <label className="wide">Package description<textarea value={form.package_description || ""} onChange={(event) => setField("package_description", event.target.value)} /></label>
            <label className="wide">Next steps<textarea value={form.next_steps || ""} onChange={(event) => setField("next_steps", event.target.value)} /></label>
            <label className="wide">Terms<textarea value={form.terms || ""} onChange={(event) => setField("terms", event.target.value)} /></label>
          </div>
        </section>
        <div className="modal-actions"><Link to="/sales/proposals">Cancel</Link><button className="primary-action">Create Proposal</button></div>
      </form>
    </main>
  );
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === "" ? null : item]));
}
