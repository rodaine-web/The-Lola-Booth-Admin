import { Archive, ArrowDown, ArrowUp, Eye, ImagePlus, Save, Send, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import MediaSelect from "../components/MediaSelect.jsx";
import { api } from "../api/client.js";

const configs = {
  pageItems:{type:'pageItems',title:'Page Items',eyebrow:'Website CMS',columns:['page_slug','slot_key','html','display_order','status'],fields:[['page_slug','Page'],['slot_key','Website slot'],['html','Copy (basic HTML)','textarea'],['href','Link URL'],['display_order','Display order','number']],empty:'No page items.'},
  mediaMappings:{type:'mediaMappings',title:'Website Images',eyebrow:'Website CMS',columns:['asset_key','media_id','status'],fields:[['asset_key','Website asset key'],['media_id','Media ID'],['display_order','Display order','number']],empty:'No website images.'},
  homepage: {
    type: "content",
    title: "Page SEO",
    eyebrow: "Website CMS",
    columns: ["content_key", "title", "status", "published_at"],
    fields: [
      ["content_key", "Content key"],
      ["title", "Title"],

      ["seo_title", "SEO title"],
      ["seo_description", "Meta description", "textarea"]
    ],
    guidance: "Edit visible page copy in Page Items. These records manage page titles and search descriptions.",
    empty: "No page metadata yet."
  },
  hero: {
    type: "hero",
    title: "Hero Slides",
    eyebrow: "Website CMS",
    columns: ["display_order", "headline", "alt_text", "is_active", "status"],
    fields: [
      ["desktop_image_file_id", "Desktop image media ID"],
      ["mobile_image_media_id", "Mobile image media ID"],
      ["alt_text", "Alt text", "textarea"],
      ["caption", "Caption"],
      ["display_order", "Display order", "number"],
      ["focal_x", "Focal X", "number"],
      ["focal_y", "Focal Y", "number"],
      ["is_active", "Active", "checkbox"]
    ],
    guidance: "Recommended: horizontal, high-resolution, event-focused images. Keep important faces away from extreme crop edges.",
    empty: "No hero slides yet. Upload your first slide."
  },
  gallery: {
    type: "gallery",
    title: "Gallery",
    eyebrow: "Website CMS",
    columns: ["display_order", "title", "category", "is_featured", "status"],
    fields: [
      ["media_id", "Media ID"],
      ["title", "Title"],
      ["caption", "Caption", "textarea"],
      ["alt_text", "Alt text", "textarea"],
      ["category", "Category"],
      ["tags", "Tags"],
      ["display_order", "Display order", "number"],
      ["is_featured", "Featured", "checkbox"]
    ],
    guidance: "Public gallery images must use approved PUBLIC media. Event galleries remain private until explicitly selected.",
    empty: "No public gallery images. Choose photos from an event or upload media."
  },
  testimonials: {
    type: "testimonials",
    title: "Testimonials",
    eyebrow: "Website CMS",
    columns: ["display_order", "client_display_name", "event_type", "is_featured", "status"],
    fields: [
      ["client_name", "Internal client name"],
      ["client_display_name", "Public display name"],
      ["event_type", "Event type"],
      ["quote", "Quote", "textarea"],
      ["rating", "Rating", "number"],
      ["client_photo_media_id", "Client photo media ID"],
      ["display_order", "Display order", "number"],
      ["is_featured", "Featured", "checkbox"]
    ],
    empty: "No testimonials published. Add a client testimonial."
  },
  faqs: {
    type: "faqs",
    title: "FAQ",
    eyebrow: "Website CMS",
    columns: ["display_order", "question", "category", "status"],
    fields: [
      ["question", "Question"],
      ["answer", "Answer", "textarea"],
      ["category", "Category"],
      ["display_order", "Display order", "number"]
    ],
    empty: "No FAQ entries yet."
  },
  events: {
    type: "eventTypes",
    title: "Event Types",
    eyebrow: "Website CMS",
    columns: ["display_order", "name", "slug", "show_on_website", "status"],
    fields: [
      ["name", "Name"],
      ["slug", "Slug"],
      ["short_description", "Short description", "textarea"],
      ["home_description", "Homepage description", "textarea"],
      ["home_display_order", "Homepage order", "number"],
      ["long_description", "Long description", "textarea"],
      ["image_media_id", "Image media ID"],
      ["display_order", "Display order", "number"],
      ["show_on_website", "Show on website", "checkbox"],
      ["seo_title", "SEO title"],
      ["meta_description", "Meta description", "textarea"]
    ],
    empty: "No public event types yet."
  }
};

const siteFields = [
  ["contact_email", "Contact email", "email"],
  ["phone", "Phone"],
  ["service_area", "Service area"],
  ["instagram_url", "Instagram URL"],
  ["tiktok_url", "TikTok URL"],
  ["facebook_url", "Facebook URL"],
  ["pinterest_url", "Pinterest URL"],
  ["copyright_text", "Copyright text"],
  ["brand_line", "Brand line"],
  ["site_title", "Site title"],
  ["default_meta_description", "Default meta description", "textarea"],
  ["canonical_domain", "Canonical domain"],
  ["social_share_title", "Social share title"],
  ["social_share_description", "Social share description", "textarea"],
  ["show_starting_price", "Show starting prices", "checkbox"]
];

export default function WebsiteCms({ section }) {
  if (section === "media") return <MediaLibrary />;
  if (section === "settings") return <SiteSettings />;
  return <CmsEditor config={configs[section] || configs.homepage} />;
}

function CmsEditor({ config }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({});
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { load(); }, [config.type, search, status]);

  async function load() {
    setError("");
    try {
      const result = await api.get(`/website/${config.type}?search=${encodeURIComponent(search)}${status ? `&status=${status}` : ""}`);
      setRows(result.data || []);
    } catch (err) {
      setRows([]);
      setError(err.message);
    }
  }

  function openCreate() {
    setEditing({ mode: "create" });
    setForm(Object.fromEntries(config.fields.map(([name, , type]) => [name, type === "checkbox" ? false : type === "number" ? 0 : ""])));
  }

  function openEdit(row) {
    setEditing({ mode: "edit", id: row.id });
    setForm(Object.fromEntries(config.fields.map(([name, , type]) => {
      const value = row[name];
      return [name, type === "checkbox" ? Boolean(value) : type === "json" ? JSON.stringify(value || {}, null, 2) : Array.isArray(value) ? value.join(", ") : value ?? ""];
    })));
  }

  async function save(event, publishNow = false) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const payload = { ...normalizePayload(config.fields, form), status: publishNow ? "PUBLISHED" : "DRAFT" };
      const saved = editing.mode === "edit"
        ? await api.patch(`/website/${config.type}/${editing.id}`, payload)
        : await api.post(`/website/${config.type}`, payload);
      if (publishNow) await api.post(`/website/${config.type}/${saved.id}/publish`, {});
      setEditing(null);
      setNotice(publishNow ? "Published to the public website." : "Draft saved.");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function action(row, verb) {
    setError("");
    setNotice("");
    try {
      await api.post(`/website/${config.type}/${row.id}/${verb}`, {});
      setNotice(verb === "publish" ? "Published to the public website." : verb === "unpublish" ? "Unpublished." : "Archived.");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function move(row, offset) {
    const current = [...rows];
    const index = current.findIndex((item) => item.id === row.id);
    const target = index + offset;
    if (target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    setRows(current);
    await api.post(`/website/${config.type}/reorder`, { orderedIds: current.map((item) => item.id) });
  }

  async function previewHomepage() {
    setError("");
    try {
      setPreview(await api.get("/website/preview"));
      setNotice("Draft preview payload loaded below. It is authenticated and not public-indexable.");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <CmsHeading title={config.title} eyebrow={config.eyebrow} onCreate={openCreate} />
      {config.guidance && <p className="cms-guidance">{config.guidance}</p>}
      {(notice || error) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <div className="toolbar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}...`} />
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option>DRAFT</option><option>PUBLISHED</option><option>ARCHIVED</option></select>
        <button className="primary-action" onClick={previewHomepage}><Eye size={16} />Preview</button>
      </div>
      {preview && <pre className="cms-preview">{JSON.stringify(preview, null, 2)}</pre>}
      <CmsTable rows={rows} columns={config.columns} empty={config.empty} onEdit={openEdit} onAction={action} onMove={move} actions={["publish", "unpublish", "archive"]} />
      {editing && (
        <CmsModal title={`${editing.mode === "edit" ? "Edit" : "New"} ${config.title.replace(/s$/, "")}`} fields={config.fields} form={form} setForm={setForm} onClose={() => setEditing(null)} onSave={save} />
      )}
    </main>
  );
}

function MediaLibrary() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [upload, setUpload] = useState({ visibility: "PRIVATE", permissionState: "UNKNOWN", mediaType: "IMAGE" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { load(); }, [search]);

  async function load() {
    const result = await api.get(`/website/media?search=${encodeURIComponent(search)}`).catch((err) => {
      setError(err.message);
      return { data: [] };
    });
    setRows(result.data || []);
  }

  async function selectFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const data = await fileToDataUrl(file);
    const dimensions = file.type.startsWith("image/") ? await imageDimensions(data).catch(() => ({})) : {};
    setUpload((current) => ({ ...current, filename: file.name, mimeType: file.type, data, ...dimensions }));
  }

  async function submit(event) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      await api.post("/website/media", upload);
      setUpload({ visibility: "PRIVATE", permissionState: "UNKNOWN", mediaType: "IMAGE" });
      setNotice("Media uploaded.");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <CmsHeading title="Media Library" eyebrow="Website CMS" />
      {(notice || error) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <section className="panel cms-upload">
        <h2>Upload media</h2>
        <p className="note-text">JPEG, PNG, WebP, and PDF are accepted. Public gallery media must be marked PUBLIC and APPROVED before publishing.</p>
        <form className="inline-form" onSubmit={submit}>
          <label className="wide">File<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={selectFile} /></label>
          <label>Alt text<input value={upload.altText || ""} onChange={(event) => setUpload((current) => ({ ...current, altText: event.target.value }))} /></label>
          <label>Caption<input value={upload.caption || ""} onChange={(event) => setUpload((current) => ({ ...current, caption: event.target.value }))} /></label>
          <label>Tags<input value={upload.tags || ""} onChange={(event) => setUpload((current) => ({ ...current, tags: event.target.value }))} /></label>
          <label>Visibility<select value={upload.visibility} onChange={(event) => setUpload((current) => ({ ...current, visibility: event.target.value }))}><option>PRIVATE</option><option>PUBLIC</option></select></label>
          <label>Permission<select value={upload.permissionState} onChange={(event) => setUpload((current) => ({ ...current, permissionState: event.target.value }))}><option>UNKNOWN</option><option>APPROVED</option><option>RESTRICTED</option><option>DO_NOT_PUBLISH</option></select></label>
          <button className="primary-action" disabled={!upload.data}><UploadCloud size={16} />Upload</button>
        </form>
      </section>
      <div className="toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search media..." /></div>
      <CmsTable rows={rows} columns={["filename", "media_type", "visibility", "permission_state", "usage_count"]} empty="No media uploaded yet." actions={["archive"]} onAction={async (row, verb) => {
        if (verb === "archive") {
          await api.delete(`/website/media/${row.id}`);
          await load();
        }
      }} />
    </main>
  );
}

function SiteSettings() {
  const [form, setForm] = useState({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { api.get("/website/site-settings").then(setForm).catch((err) => setError(err.message)); }, []);

  async function save(event) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      setForm(await api.patch("/website/site-settings", normalizePayload(siteFields, form)));
      setNotice("Site settings published.");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <CmsHeading title="SEO / Site Settings" eyebrow="Website CMS" />
      {(notice || error) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <section className="brand-settings-preview">
        <div>
          <p className="eyebrow">Website logo rule</p>
          <h2>Use the stacked logo first</h2>
          <p className="note-text">Public website headers, hero sections, and footer branding should prioritize the approved vertical/stacked LOLA logo.</p>
        </div>
        <div className="brand-asset-row">
          <img src="/brand/LOLA_Primary_Dark_Transparent.png" alt="Primary stacked LOLA logo" />
          <img src="/brand/LOLA_Primary_Light_Transparent.png" alt="Primary stacked light LOLA logo" />
          <img src="/brand/LOLA_LB_Monogram_Gold.png" alt="Gold LB monogram" />
        </div>
      </section>
      <form className="panel form-grid" onSubmit={save}>
        {siteFields.map(([name, label, type = "text"]) => <Field key={name} name={name} label={label} type={type} form={form} setForm={setForm} />)}
        <div className="modal-actions wide"><button className="primary-action"><Send size={16} />Publish Site Settings</button></div>
      </form>
    </main>
  );
}

function CmsHeading({ title, eyebrow, onCreate }) {
  return (
    <div className="page-heading">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>
      {onCreate && <button className="primary-action" onClick={onCreate}><ImagePlus size={16} />New</button>}
    </div>
  );
}

function CmsTable({ rows, columns, empty, onEdit, onAction, onMove, actions = [] }) {
  if (!rows.length) return <div className="empty-state">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((column) => <th key={column}>{labelize(column)}</th>)}<th>Actions</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => <td key={column}>{formatCell(row[column])}</td>)}
              <td>
                <div className="cms-actions">
                  {onMove && <button title="Move up" onClick={() => onMove(row, -1)}><ArrowUp size={15} /></button>}
                  {onMove && <button title="Move down" onClick={() => onMove(row, 1)}><ArrowDown size={15} /></button>}
                  {onEdit && <button onClick={() => onEdit(row)}><Save size={15} />Edit</button>}
                  {onAction && actions.includes("publish") && <button onClick={() => onAction(row, "publish")}><Send size={15} />Publish</button>}
                  {onAction && actions.includes("unpublish") && <button onClick={() => onAction(row, "unpublish")}>Unpublish</button>}
                  {onAction && actions.includes("archive") && <button onClick={() => onAction(row, "archive")}><Archive size={15} />Archive</button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CmsModal({ title, fields, form, setForm, onClose, onSave }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={(event) => onSave(event, false)}>
        <div className="modal-heading"><h2>{title}</h2><button type="button" onClick={onClose}>Close</button></div>
        <div className="form-grid">
          {fields.map(([name, label, type = "text"]) => <Field key={name} name={name} label={label} type={type} form={form} setForm={setForm} />)}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button><Save size={16} />Save Draft</button>
          <button type="button" className="primary-action" onClick={(event) => onSave(event, true)}><Send size={16} />Publish</button>
        </div>
      </form>
    </div>
  );
}

function Field({ name, label, type, form, setForm }) {
  return (
    <label className={type === "textarea" || type === "json" ? "wide" : ""}>
      {label}
      {(name.endsWith("media_id") || name === "desktop_image_file_id") ? <MediaSelect value={form[name]} onChange={value=>setForm(current=>({...current,[name]:value}))}/> : type === "textarea" || type === "json" ? (
        <textarea value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />
      ) : type === "checkbox" ? (
        <input type="checkbox" checked={Boolean(form[name])} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.checked }))} />
      ) : (
        <input type={type} value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />
      )}
    </label>
  );
}

function normalizePayload(fields, form) {
  const fieldTypes = Object.fromEntries(fields.map(([name, , type = "text"]) => [name, type]));
  return Object.fromEntries(Object.entries(form).map(([key, value]) => {
    if (value === "") return [key, null];
    if (fieldTypes[key] === "number") return [key, Number(value)];
    if (fieldTypes[key] === "json" && typeof value === "string") return [key, JSON.parse(value || "{}")];
    return [key, value];
  }));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageDimensions(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = src;
  });
}

function labelize(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleDateString();
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}
