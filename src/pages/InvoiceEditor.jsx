import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import RelationshipSelect from "../components/RelationshipSelect.jsx";

export default function InvoiceEditor() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [loaded, setLoaded] = useState(!id);
  const [params] = useSearchParams();
  const [form, setForm] = useState({ proposal_id: params.get("proposalId") || "", client_id: params.get("clientId") || "", event_id: params.get("eventId") || "", depositOnly: false, items: [] });
  const [item, setItem] = useState({ description: "", quantity: 1, unit_price: 0, taxable: true, tax_rate: 0, discount: 0 });
  const [error, setError] = useState("");

  useEffect(() => { if (id) api.get(`/invoices/${id}`).then(invoice => { setForm({...invoice, due_date: invoice.due_date?.slice(0,10) || "", items: invoice.items || []}); setLoaded(true); }).catch(err => setError(err.message)); }, [id]);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    try {
      const payload = compact({client_id:form.client_id,event_id:form.event_id,due_date:form.due_date,notes:form.notes,terms:form.terms,items:form.items,...(!id ? {proposal_id:form.proposal_id,depositOnly:form.depositOnly} : {})});
      const created = id ? await api.patch(`/invoices/${id}`, payload) : await api.post("/invoices", payload);
      navigate(`/finance/invoices/${created.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="detail-back"><Link to="/finance/invoices"><ArrowLeft size={16} />Back to invoices</Link></div>
      <div className="page-heading"><div><p className="eyebrow">Invoice editor</p><h1>{id ? "Edit Invoice" : "New Invoice"}</h1></div></div>
      {error && <div className="toast error">{error}</div>}
      <form className="document-editor" onSubmit={save}>
        <section className="panel">
          <h2>Source</h2>
          <div className="form-grid">
            {!id && <label>Proposal<RelationshipSelect resource="proposals" value={form.proposal_id} placeholder="Proposal" onChange={(value) => setField("proposal_id", value)} /></label>}
            <label>Client<RelationshipSelect resource="clients" value={form.client_id} placeholder="Client" onChange={(value) => setField("client_id", value)} /></label>
            <label>Event<RelationshipSelect resource="events" value={form.event_id} placeholder="Event" onChange={(value) => setField("event_id", value)} /></label>
            <label>Due date<input type="date" value={form.due_date || ""} onChange={(event) => setField("due_date", event.target.value)} /></label>
            {!id && <label className="check-row"><input type="checkbox" checked={Boolean(form.depositOnly)} onChange={(event) => setField("depositOnly", event.target.checked)} /><span>Deposit invoice</span></label>}
            <label className="wide">Notes<textarea value={form.notes || ""} onChange={(event) => setField("notes", event.target.value)} /></label>
          </div>
        </section>
        {(id || !form.proposal_id) && (
          <section className="panel">
            <h2>Line Items</h2>
            <div className="inline-form invoice-line-form">
              <input value={item.description} onChange={(event) => setItem((current) => ({ ...current, description: event.target.value }))} placeholder="Description" />
              <input type="number" min="1" value={item.quantity} onChange={(event) => setItem((current) => ({ ...current, quantity: event.target.value }))} />
              <input type="number" min="0" value={item.unit_price} onChange={(event) => setItem((current) => ({ ...current, unit_price: event.target.value }))} />
              <input type="number" min="0" value={item.tax_rate} onChange={(event) => setItem((current) => ({ ...current, tax_rate: event.target.value }))} />
              <button type="button" className="primary-action" disabled={!item.description} onClick={() => { setForm((current) => ({ ...current, items: [...current.items, item] })); setItem({ description: "", quantity: 1, unit_price: 0, taxable: true, tax_rate: 0, discount: 0 }); }}><Plus size={16} />Add</button>
            </div>
            <div className="line-list">{form.items.map((line, index) => <div key={`${line.description}-${index}`}><span>{line.description} · {line.quantity} x ${line.unit_price}</span><button type="button" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></div>)}</div>
          </section>
        )}
        <div className="modal-actions"><Link to="/finance/invoices">Cancel</Link><button className="primary-action" disabled={!loaded}>{id ? "Save Invoice" : "Create Invoice"}</button></div>
      </form>
    </main>
  );
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === "" ? null : item]));
}
