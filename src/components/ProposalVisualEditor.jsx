import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
const types = [
  ["EXPERIENCE", "Your LOLA Experience"],
  ["BOOTH", "Booth"],
  ["BACKDROP", "Backdrop"],
  ["OVERLAY", "Photo Design"],
  ["WELCOME_SCREEN", "Welcome Screen"],
  ["GALLERY_BRANDING", "Gallery Experience"],
  ["CLIENT_LOGO", "Client Logo"],
  ["REFERENCE", "Reference Mockup"],
  ["BRAND_ACTIVATION", "Brand Experience Preview"],
  ["TIMELINE", "Timeline"],
];
function AssetImage({ id }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true,
      objectUrl;
    api
      .blob(`/proposal-assets/${id}/file`)
      .then((b) => {
        objectUrl = URL.createObjectURL(b);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url ? (
    <img src={url} alt="Selected visual asset" />
  ) : (
    <span>Preview unavailable</span>
  );
}
export default function ProposalVisualEditor({ value = [], onChange }) {
  const [assets, setAssets] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => api.get("/proposal-assets").then((r) => setAssets(r.data));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const update = (index, patch) =>
    onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  function move(i, d) {
    const next = [...value],
      j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  async function upload(file, index) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose an image up to 10 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const asset = await api.post("/proposal-assets", {
        filename: file.name,
        mimeType: file.type,
        data,
      });
      update(index, {
        media_ids: [...value[index].media_ids, asset.id].slice(0, 4),
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel proposal-visual-editor">
      <p className="eyebrow">WHAT IT WILL LOOK LIKE</p>
      <h2>Your LOLA Experience</h2>
      <p className="note-text">
        Optional visual sections. Add only what helps your client picture the
        experience. These appear on the secure proposal and its PDF.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="section-pills">
        {types.map(([kind, title]) => (
          <button
            type="button"
            disabled={value.length >= 16}
            key={kind}
            onClick={() =>
              onChange([
                ...value,
                {
                  id: crypto.randomUUID(),
                  kind,
                  title,
                  body: "",
                  media_ids: [],
                },
              ])
            }
          >
            <Plus size={13} />
            {title}
          </button>
        ))}
      </div>
      {value.map((section, index) => (
        <article className="visual-section-editor" key={section.id}>
          <div className="section-toolbar">
            <input
              aria-label="Visual section title"
              maxLength={100}
              value={section.title}
              onChange={(e) => update(index, { title: e.target.value })}
            />
            <button
              type="button"
              aria-label="Move visual section up"
              disabled={!index}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              type="button"
              aria-label="Move visual section down"
              disabled={index === value.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={15} />
            </button>
            <button
              type="button"
              aria-label="Remove visual section"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <Trash2 size={15} />
            </button>
          </div>
          <textarea
            aria-label="Experience description"
            maxLength={3000}
            value={section.body}
            onChange={(e) => update(index, { body: e.target.value })}
            placeholder="Describe the look, guest journey, capture modes, sharing methods or deliverables."
          />
          <div className="proposal-asset-grid">
            {section.media_ids.map((id) => (
              <figure key={id}>
                <AssetImage id={id} />
                <button
                  type="button"
                  onClick={() =>
                    update(index, {
                      media_ids: section.media_ids.filter((x) => x !== id),
                    })
                  }
                >
                  Remove image
                </button>
              </figure>
            ))}
          </div>
          {section.media_ids.length < 4 && (
            <div className="form-grid">
              <label>
                Select approved library asset
                <select
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    update(index, {
                      media_ids: [...section.media_ids, e.target.value],
                    })
                  }
                >
                  <option value="">Choose an image</option>
                  {assets
                    .filter((a) => !section.media_ids.includes(a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.alt_text || a.filename}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Upload proposal image
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={busy}
                  onChange={(e) => {
                    upload(e.target.files[0], index);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
