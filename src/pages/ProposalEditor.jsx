import ProposalVisualEditor from "../components/ProposalVisualEditor.jsx";
import {selectProposalPackage,selectProposalExperience} from '../../shared/proposal-catalog.js';
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
  const [experienceOptions, setExperienceOptions] = useState([]);
  const [packageOptions, setPackageOptions] = useState([]);
  const [upload, setUpload] = useState({ filename: "", pdf_base64: "" });
  const [inlineClientOpen,setInlineClientOpen]=useState(false);
  const [inlineEventOpen,setInlineEventOpen]=useState(false);
  const [inlineClientSaving,setInlineClientSaving]=useState(false);
  const [inlineEventSaving,setInlineEventSaving]=useState(false);
  const [inlineClient,setInlineClient]=useState({first_name:"",last_name:"",email:"",phone:""});
  const [inlineEvent,setInlineEvent]=useState({event_name:"",event_type:"",event_date:"",start_time:"",end_time:"",venue_name:"",venue_address:"",city:"",state:"",zip:""});
  const [form, setForm] = useState({
    lead_id: params.get("leadId") || "",
    client_id: params.get("clientId") || "",
    event_id: params.get("eventId") || "",
    proposal_title: "Custom Experience Proposal",
    proposal_type: "PRIVATE_EVENT",
    proposal_date: new Date().toISOString().slice(0, 10),
    package_id: "",
    experience_id: "",
    selected_experiences: [],
    proposal_visuals: {},
    status: "DRAFT",
    deposit_type: "PERCENTAGE",
    deposit_value: 30,
    addons: [],
    custom_line_items: [],
    sections: ["Introduction", "Event Details", "Proposed Experience", "Package Includes", "Investment Summary", "Next Steps", "Terms"].map((title, index) => section(title, index))
  });
  const [error, setError] = useState("");
  const [saving,setSaving]=useState(false);
  const [hydratingSource,setHydratingSource]=useState(false);

  useEffect(() => { if (id) api.get(`/proposals/${id}`).then(proposal => { setForm(proposal.editable_input); setLoaded(true); }).catch(err => setError(err.message)); }, [id]);
  useEffect(() => {
    Promise.all([
      api.get("/experiences?pageSize=100"),
      api.get("/packages?pageSize=200")
    ]).then(([experiences, packages]) => {
      setExperienceOptions(experiences?.data || experiences || []);
      setPackageOptions(packages?.data || packages || []);
    }).catch(() => {
      setExperienceOptions([]);
      setPackageOptions([]);
    });
  }, []);

  useEffect(() => {
    const leadId = params.get("leadId");
    if (!id && leadId) hydrateFromLead(leadId);
  }, [id]);

  useEffect(() => {
    if (form.event_id) {
      api.get(`/events/${form.event_id}`).then((event) => {
        setForm((current) => ({
          ...current,
          client_id: event.client_id || current.client_id,
          package_id: event.package_id || current.package_id,
          experience_id: event.experience_id || current.experience_id
        }));
      }).catch(() => {});
    }
  }, [form.event_id]);

  async function hydrateFromLead(leadId) {
    if (!leadId) return;
    setHydratingSource(true);
    setError("");
    try {
      const lead = await api.get(`/leads/${leadId}`);
      setForm((current) => hydrateProposalFromLead(current, lead));
    } catch (err) {
      setError(err.message);
    } finally {
      setHydratingSource(false);
    }
  }

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function toggleExperience(experience) {
    setForm((current) => {
      const selected = current.selected_experiences || [];
      const exists = selected.some((item) => item.experience_id === experience.id);
      const next = exists
        ? selected.filter((item) => item.experience_id !== experience.id)
        : [...selected, {
            experience_id: experience.id,
            name: experience.name,
            package_name: "",
            packages: [],
            price: Number(experience.base_price || 0),
            headline: "",
            description: experience.proposal_description || experience.description || "",
            visuals: {}
          }];
      return { ...current, selected_experiences: next, experience_id: next[0]?.experience_id || current.experience_id || "" };
    });
  }

  function toggleExperiencePackage(index, pkg) {
    setForm((current) => ({
      ...current,
      selected_experiences: (current.selected_experiences || []).map((item, i) => {
        if (i !== index) return item;
        const selected = Array.isArray(item.packages) ? item.packages : [];
        const exists = selected.some((entry) => entry.package_id === pkg.id);
        const packages = exists
          ? selected.filter((entry) => entry.package_id !== pkg.id)
          : [...selected, {
              package_id: pkg.id,
              name: pkg.name,
              price: Number(pkg.starting_price || 0),
              description: pkg.proposal_description || pkg.description || ""
            }];
        const experience = experienceOptions.find((entry) => entry.id === item.experience_id);
        return {
          ...item,
          packages,
          package_name: packages.map((entry) => entry.name).join(" + "),
          price: packages.length
            ? packages.reduce((sum, entry) => sum + Number(entry.price || 0), 0)
            : Number(experience?.base_price || 0)
        };
      })
    }));
  }

  function updateSelectedExperience(index, patch) {
    setForm((current) => ({
      ...current,
      selected_experiences: (current.selected_experiences || []).map((item, i) => i === index ? { ...item, ...patch } : item)
    }));
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

  async function createInlineClient() {
    if (inlineClientSaving) return;
    setInlineClientSaving(true);
    setError("");
    try {
      const created = await api.post("/clients", inlineClient);
      setForm((current) => ({ ...current, client_id: created.id }));
      setInlineClientOpen(false);
      setInlineClient({first_name:"",last_name:"",email:"",phone:""});
    } catch (err) {
      setError(err.message);
    } finally {
      setInlineClientSaving(false);
    }
  }

  async function createInlineEvent() {
    if (inlineEventSaving) return;
    if (!form.client_id) {
      setError("Choose or create a client before creating an event.");
      return;
    }
    setInlineEventSaving(true);
    setError("");
    try {
      const created = await api.post("/events", {
        ...inlineEvent,
        client_id: form.client_id,
        package_id: form.package_id || null,
        experience_id: form.experience_id || null,
        status: "TENTATIVE"
      });
      setForm((current) => ({ ...current, event_id: created.id }));
      setInlineEventOpen(false);
      setInlineEvent({event_name:"",event_type:"",event_date:"",start_time:"",end_time:"",venue_name:"",venue_address:"",city:"",state:"",zip:""});
    } catch (err) {
      setError(err.message);
    } finally {
      setInlineEventSaving(false);
    }
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUpload({ filename: file.name, pdf_base64: await toBase64(file) });
  }

  async function save(event) {
    event.preventDefault();
    if(saving)return;setSaving(true);
    setError("");
    try {
      const payload = compact({ ...form, ...upload, total_investment: form.package_amount });
      const created = id ? await api.patch(`/proposals/${id}`, payload) : mode === "upload" ? await api.post("/proposals/upload", payload) : await api.post("/proposals", payload);
      navigate(`/sales/proposals/${created.id}`);
    } catch (err) {
      setError(err.message);
    } finally {setSaving(false);}
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
      {error && <div id="proposal-error" role="alert" className="toast error">{error}</div>}
      <form aria-describedby={error?"proposal-error":undefined} className="document-editor" onSubmit={save}>
        <section className="panel">
          <h2>Proposal</h2>
          <div className="form-grid">
            <label>Lead<RelationshipSelect resource="leads" value={form.lead_id} placeholder="Lead" onChange={(value) => { setField("lead_id", value); hydrateFromLead(value); }} /></label>
            <label>Client<RelationshipSelect resource="clients" value={form.client_id} placeholder="Client" onChange={(value) => setField("client_id", value)} />
              {!id && <button type="button" onClick={()=>setInlineClientOpen(value=>!value)}>{inlineClientOpen?"Cancel new client":"Create new client"}</button>}
            </label>
            <label>Event<RelationshipSelect resource="events" value={form.event_id} placeholder="Event" onChange={(value) => setField("event_id", value)} />
              {!id && <button type="button" onClick={()=>setInlineEventOpen(value=>!value)}>{inlineEventOpen?"Cancel new event":"Create new event"}</button>}
            </label>
            <label>Proposal type<select value={form.proposal_type || "PRIVATE_EVENT"} onChange={(event) => setField("proposal_type", event.target.value)}>
              <option value="WEDDING">Wedding</option>
              <option value="PRIVATE_EVENT">Private Event</option>
              <option value="CORPORATE">Corporate</option>
              <option value="BRAND_ACTIVATION">Brand Activation</option>
              <option value="CUSTOM">Custom</option>
            </select></label>
            <label>Proposal title<input value={form.proposal_title || ""} onChange={(event) => setField("proposal_title", event.target.value)} /></label>
            <label>Proposal date<input type="date" value={form.proposal_date || ""} onChange={(event) => setField("proposal_date", event.target.value)} /></label>
            <label>Expiration date<input type="date" value={form.valid_through || ""} onChange={(event) => setField("valid_through", event.target.value)} /></label>
            <label>Status<select value={form.status} onChange={(event) => setField("status", event.target.value)}>{["DRAFT", "READY"].map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
        </section>

        {!id && inlineClientOpen && <section className="panel">
          <h2>Create Client</h2>
          <p className="lede">Create the client here and continue building the proposal without leaving this page.</p>
          <div className="form-grid">
            <label>First name<input required value={inlineClient.first_name} onChange={(event)=>setInlineClient(current=>({...current,first_name:event.target.value}))}/></label>
            <label>Last name<input required value={inlineClient.last_name} onChange={(event)=>setInlineClient(current=>({...current,last_name:event.target.value}))}/></label>
            <label>Email<input required type="email" value={inlineClient.email} onChange={(event)=>setInlineClient(current=>({...current,email:event.target.value}))}/></label>
            <label>Phone<input required type="tel" value={inlineClient.phone} onChange={(event)=>setInlineClient(current=>({...current,phone:event.target.value}))}/></label>
          </div>
          <div className="button-row">
            <button type="button" onClick={()=>setInlineClientOpen(false)}>Cancel</button>
            <button type="button" className="primary-action" disabled={inlineClientSaving||!inlineClient.first_name||!inlineClient.last_name||!inlineClient.email||String(inlineClient.phone||"").replace(/\D/g,"").length<7} onClick={createInlineClient}>{inlineClientSaving?"Creating…":"Create client & use"}</button>
          </div>
        </section>}

        {!id && inlineEventOpen && <section className="panel">
          <h2>Create Event</h2>
          <p className="lede">Create and link the event here. A client must be selected first.</p>
          <div className="form-grid">
            <label>Event title<input required value={inlineEvent.event_name} onChange={(event)=>setInlineEvent(current=>({...current,event_name:event.target.value}))}/></label>
            <label>Event type<input required value={inlineEvent.event_type} onChange={(event)=>setInlineEvent(current=>({...current,event_type:event.target.value}))}/></label>
            <label>Event date<input required type="date" value={inlineEvent.event_date} onChange={(event)=>setInlineEvent(current=>({...current,event_date:event.target.value}))}/></label>
            <label>Start time<input required type="time" value={inlineEvent.start_time} onChange={(event)=>setInlineEvent(current=>({...current,start_time:event.target.value}))}/></label>
            <label>End time<input required type="time" value={inlineEvent.end_time} onChange={(event)=>setInlineEvent(current=>({...current,end_time:event.target.value}))}/></label>
            <label>Venue<input value={inlineEvent.venue_name} onChange={(event)=>setInlineEvent(current=>({...current,venue_name:event.target.value}))}/></label>
            <label>Address<input value={inlineEvent.venue_address} onChange={(event)=>setInlineEvent(current=>({...current,venue_address:event.target.value}))}/></label>
            <label>City<input value={inlineEvent.city} onChange={(event)=>setInlineEvent(current=>({...current,city:event.target.value}))}/></label>
            <label>State<input value={inlineEvent.state} onChange={(event)=>setInlineEvent(current=>({...current,state:event.target.value}))}/></label>
            <label>ZIP<input value={inlineEvent.zip} onChange={(event)=>setInlineEvent(current=>({...current,zip:event.target.value}))}/></label>
          </div>
          <div className="button-row">
            <button type="button" onClick={()=>setInlineEventOpen(false)}>Cancel</button>
            <button type="button" className="primary-action" disabled={inlineEventSaving||!form.client_id||!inlineEvent.event_name||!inlineEvent.event_type||!inlineEvent.event_date||!inlineEvent.start_time||!inlineEvent.end_time} onClick={createInlineEvent}>{inlineEventSaving?"Creating…":"Create event & use"}</button>
          </div>
        </section>}

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
              <h2>Selected Experiences</h2>
              <p className="lede">Every selected experience becomes its own visual section in the client proposal.</p>
              <div className="proposal-experience-picker">
                {experienceOptions.map((experience) => {
                  const selected = (form.selected_experiences || []).some((item) => item.experience_id === experience.id);
                  return <button type="button" key={experience.id} className={selected ? "proposal-experience-choice selected" : "proposal-experience-choice"} onClick={() => toggleExperience(experience)}>
                    <strong>{experience.name}</strong><span>{selected ? "Selected" : "Add to proposal"}</span>
                  </button>;
                })}
              </div>
              <div className="proposal-experience-editors">
                {(form.selected_experiences || []).map((item, index) => (
                  <article className="proposal-experience-editor" key={item.experience_id || index}>
                    <div className="section-toolbar">
                      <strong>{item.name || `Experience ${index + 1}`}</strong>
                      <button type="button" aria-label="Remove experience" onClick={() => toggleExperience({ id: item.experience_id })}><Trash2 size={14} /></button>
                    </div>
                    <div className="form-grid">
                      <label>Display name<input value={item.name || ""} onChange={(event) => updateSelectedExperience(index, { name: event.target.value })} /></label>
                      <fieldset className="wide">
                        <legend>Packages</legend>
                        {packageOptions
                          .filter((pkg) => !pkg.experience_id || pkg.experience_id === item.experience_id)
                          .map((pkg) => (
                            <label className="check-row" key={pkg.id}>
                              <input
                                type="checkbox"
                                checked={(item.packages || []).some((entry) => entry.package_id === pkg.id)}
                                onChange={() => toggleExperiencePackage(index, pkg)}
                              />
                              <span>{pkg.name}{pkg.starting_price != null ? ` · ${Number(pkg.starting_price).toLocaleString()}` : ""}</span>
                            </label>
                          ))}
                        {!packageOptions.some((pkg) => !pkg.experience_id || pkg.experience_id === item.experience_id) && <p className="note-text">No catalog packages are linked to this experience yet.</p>}
                      </fieldset>
                      <label>Selected package total<input type="number" min="0" step="0.01" value={item.price ?? ""} onChange={(event) => updateSelectedExperience(index, { price: event.target.value })} /></label>
                      <label>Headline<input value={item.headline || ""} onChange={(event) => updateSelectedExperience(index, { headline: event.target.value })} /></label>
                      <label className="wide">Description<textarea value={item.description || ""} onChange={(event) => updateSelectedExperience(index, { description: event.target.value })} /></label>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2>Services / Pricing</h2>
              <div className="form-grid">
                <label>Package<RelationshipSelect resource="packages" value={form.package_id} placeholder="Package" filters={{experience_id:form.experience_id}} onChange={(_value,pack) => setForm(current=>selectProposalPackage(current,pack))} /></label>
                <label>Experience<RelationshipSelect resource="experiences" value={form.experience_id} placeholder="Experience" onChange={(value) => setForm(current=>selectProposalExperience(current,value))} /></label>
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
                <RelationshipSelect resource="addons" value={addon.addon_id} placeholder="Add-on" onChange={(value,option) => setAddon((current) => ({ ...current, addon_id: value, description:option?.label, pricing_type:option?.pricing_type, unit_price:option?.pricing_type === "CUSTOM" ? "" : option?.price }))} />
                {addon.pricing_type === "CUSTOM" && <input aria-label="Agreed add-on price" type="number" min="0.01" step="0.01" placeholder="Agreed price" value={addon.unit_price || ""} onChange={event=>setAddon(current=>({...current,unit_price:event.target.value}))}/> }
                <input aria-label="Add-on quantity" type="number" min="1" value={addon.quantity} onChange={(event) => setAddon((current) => ({ ...current, quantity: event.target.value }))} />
                <button type="button" className="primary-action" disabled={!addon.addon_id || (addon.pricing_type === "CUSTOM" && !(Number(addon.unit_price)>0))} onClick={() => { setForm((current) => ({ ...current, addons: [...current.addons, addon] })); setAddon({ addon_id: "", quantity: 1 }); }}><Plus size={16} />Add</button>
              </div>
              <div className="line-list">{form.addons.map((item, index) => <div key={`${item.addon_id}-${index}`}><span>{item.description || `Add-on ${index + 1}`} · Qty {item.quantity}</span><button type="button" aria-label="Remove add-on" onClick={() => setForm((current) => ({ ...current, addons: current.addons.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></div>)}</div>
              <div className="inline-form custom-line-form">
                <input aria-label="Custom service" placeholder="Custom service" value={customLine.description} onChange={(event) => setCustomLine((current) => ({ ...current, description: event.target.value }))} />
                <input aria-label="Description" placeholder="Description" value={customLine.detail} onChange={(event) => setCustomLine((current) => ({ ...current, detail: event.target.value }))} />
                <input aria-label="Service quantity" type="number" min="1" value={customLine.quantity} onChange={(event) => setCustomLine((current) => ({ ...current, quantity: event.target.value }))} />
                <input type="number" aria-label="Rate" placeholder="Rate" value={customLine.unit_price} onChange={(event) => setCustomLine((current) => ({ ...current, unit_price: event.target.value }))} />
                <button type="button" className="primary-action" disabled={!customLine.description} onClick={() => { setForm((current) => ({ ...current, custom_line_items: [...current.custom_line_items, customLine] })); setCustomLine({ description: "", detail: "", quantity: 1, unit_price: "" }); }}><Plus size={16} />Service</button>
              </div>
              <div className="line-list">{form.custom_line_items.map((item, index) => <div key={`${item.description}-${index}`}><span>{item.description} · Qty {item.quantity} · ${item.unit_price || 0}</span><button type="button" aria-label="Remove service" onClick={() => setForm((current) => ({ ...current, custom_line_items: current.custom_line_items.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></div>)}</div>
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
                      <input aria-label="Section title" value={item.title} onChange={(event) => updateSection(index, { title: event.target.value })} />
                      <button type="button" aria-label="Move section up" onClick={() => moveSection(index, -1)}><ArrowUp size={14} /></button>
                      <button type="button" aria-label="Move section down" onClick={() => moveSection(index, 1)}><ArrowDown size={14} /></button>
                      <button type="button" aria-label="Remove section" onClick={() => setForm((current) => ({ ...current, sections: current.sections.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button>
                    </div>
                    <textarea aria-label="Section body" value={item.body} onChange={(event) => updateSection(index, { body: event.target.value })} placeholder="Section body" />
                    <textarea aria-label="Section bullet points" className="compact-textarea" value={(item.items || []).join("\n")} onChange={(event) => updateSection(index, { items: event.target.value.split("\n").filter(Boolean) })} placeholder="Optional bullets, one per line" />
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {mode === "create" && <ProposalVisualEditor value={form.visual_sections||[]} onChange={value=>setField("visual_sections",value)}/>}
        <section className="panel">
          <h2>Terms / Notes</h2>
          <div className="form-grid">
            <label className="wide">Next steps<textarea value={form.next_steps || ""} onChange={(event) => setField("next_steps", event.target.value)} /></label>
            <label className="wide">Terms<textarea value={form.terms || ""} onChange={(event) => setField("terms", event.target.value)} /></label>
            <label className="wide">Internal notes<textarea value={form.notes || ""} onChange={(event) => setField("notes", event.target.value)} /></label>
          </div>
        </section>
        <div className="modal-actions"><Link to="/sales/proposals">Cancel</Link><button className="primary-action" disabled={!loaded||saving||hydratingSource}>{hydratingSource ? "Loading lead details…" : id ? "Save Proposal" : mode === "upload" ? "Upload Proposal" : "Create Proposal"}</button></div>
      </form>
    </main>
  );
}

function section(title, display_order = 0) {
  return { id: title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), title, body: "", items: [], display_order };
}


function hydrateProposalFromLead(current, lead) {
  const preferredExperience = lead.preferredExperience || null;
  const preferredPackage = lead.preferredPackage || null;
  const selectedExperiences = preferredExperience
    ? [{
        experience_id: preferredExperience.id,
        name: preferredExperience.name,
        package_name: preferredPackage?.name || "",
        packages: preferredPackage ? [{
          package_id: preferredPackage.id,
          name: preferredPackage.name,
          price: Number(preferredPackage.starting_price || 0),
          description: preferredPackage.proposal_description || preferredPackage.description || ""
        }] : [],
        price: Number(preferredPackage?.starting_price ?? preferredExperience.base_price ?? 0),
        headline: "",
        description: preferredExperience.proposal_description || preferredExperience.description || "",
        visuals: {}
      }]
    : current.selected_experiences || [];

  return {
    ...current,
    lead_id: lead.id || current.lead_id,
    client_id: lead.converted_client_id || current.client_id,
    event_id: lead.converted_event_id || current.event_id,
    package_id: lead.preferred_package_id || current.package_id,
    experience_id: lead.preferred_experience_id || current.experience_id,
    package_amount: preferredPackage?.starting_price ?? current.package_amount,
    selected_experiences: selectedExperiences,
    proposal_title: proposalTitleForLead(lead),
    proposal_type: proposalTypeForLead(lead.event_type),
    introduction: current.introduction || "The LOLA Booth creates polished, interactive photo experiences designed to bring people together and leave guests with something worth keeping. We combine thoughtful service, professional presentation, and memorable content for every event.",
    next_steps: current.next_steps || "Review the proposed experience and investment, let us know any edits you would like, and approve the proposal when you are ready to move forward. Once approved, we will prepare the invoice and confirm the remaining event details.",
    sections: hydrateLeadSections(current.sections || [], lead, preferredExperience, preferredPackage)
  };
}

function hydrateLeadSections(sections, lead, experience, pkg) {
  const clientName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "the client";
  const eventName = lead.event_type ? `${lead.event_type} for ${clientName}` : `Event for ${clientName}`;
  const eventDetails = [
    lead.event_date ? `Date: ${lead.event_date}` : null,
    lead.venue_name ? `Venue: ${lead.venue_name}` : null,
    [lead.venue_address, lead.city, lead.state, lead.zip].filter(Boolean).length
      ? `Location: ${[lead.venue_address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ")}`
      : null,
    lead.guest_count ? `Estimated guests: ${lead.guest_count}` : null
  ].filter(Boolean).join("\n");

  const bodyByTitle = {
    "Introduction": `Thank you, ${clientName}, for considering The LOLA Booth for ${eventName}. We are excited to create a polished, guest-friendly experience that fits the occasion and gives your guests memorable photos and moments to take with them.`,
    "Event Details": eventDetails,
    "Proposed Experience": experience
      ? `Recommended experience: ${experience.name}. ${experience.proposal_description || experience.description || ""}`.trim()
      : "Select one or more LOLA experiences for this event.",
    "Package Includes": pkg
      ? `${pkg.name}${pkg.starting_price != null ? ` starting at ${Number(pkg.starting_price).toLocaleString()}` : ""}.`
      : "Select the package and any enhancements that best fit the event.",
    "Next Steps": "Review the experience, pricing, and event details. Request any edits you need, then approve the proposal when you are ready to proceed.",
    "Terms": "Final scope, pricing, availability, and event logistics remain subject to the approved proposal and invoice."
  };

  return sections.map((item) => ({
    ...item,
    body: item.body || bodyByTitle[item.title] || ""
  }));
}

function proposalTitleForLead(lead) {
  const clientName = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  return [lead.event_type, clientName].filter(Boolean).join(" · ") || "Custom Experience Proposal";
}

function proposalTypeForLead(eventType = "") {
  const value = String(eventType).toLowerCase();
  if (value.includes("wedding")) return "WEDDING";
  if (value.includes("corporate")) return "CORPORATE";
  if (value.includes("brand")) return "BRAND_ACTIVATION";
  if (value.includes("private") || value.includes("birthday") || value.includes("shower") || value.includes("graduation")) return "PRIVATE_EVENT";
  return "CUSTOM";
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
