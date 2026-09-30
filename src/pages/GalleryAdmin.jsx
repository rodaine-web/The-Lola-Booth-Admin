import GalleryOverview from "../components/GalleryOverview.jsx";
import GalleryImports from "../components/GalleryImports.jsx";
import { useEffect, useState, useRef } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Copy,
  Download,
  ImagePlus,
  LockKeyhole,
  Plus,
  QrCode,
  Users,
  X,
} from "lucide-react";
import { api } from "../api/client.js";
import StatusBadge from "../components/StatusBadge.jsx";
import GalleryThumbnail from "../components/GalleryThumbnail.jsx";
import RelationshipSelect from "../components/RelationshipSelect.jsx";
import { formatDateOnly, formatTimestamp } from "../utils/display.js";
const base = "/gallery-admin";
const readFile = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
export default function GalleryAdmin() {
  const { id } = useParams(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const [albums, setAlbums] = useState([]),
    [data, setData] = useState(null),
    [tab, setTab] = useState("Overview"),
    [selected, setSelected] = useState([]),
    [person, setPerson] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [eventId, setEventId] = useState(params.get("eventId") || ""),
    [creating, setCreating] = useState(Boolean(params.get("eventId"))),
    [access, setAccess] = useState(null),
    [name, setName] = useState(""),
    [recipient, setRecipient] = useState(""),
    [expiry, setExpiry] = useState("");
  const accessDialog = useRef(null);
  useEffect(() => {
    if (!access) return;
    const previous = document.activeElement,
      before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    accessDialog.current?.focus();
    const key = (e) => {
      if (e.key === "Escape") setAccess(null);
      if (e.key === "Tab") {
        const nodes = [
          ...accessDialog.current.querySelectorAll("button,a,input"),
        ].filter((n) => !n.disabled);
        const first = nodes[0],
          last = nodes.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === accessDialog.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [access?.id]);
  async function load() {
    if (id) setData(await api.get(`${base}/albums/${id}`));
    else {
      const rows = (await api.get(`${base}/albums`)).data;
      setAlbums(rows);
      const existing = rows.find((a) => a.event_id === params.get("eventId"));
      if (existing) {
        setCreating(false);
        navigate(`/operations/galleries/${existing.id}`, { replace: true });
      }
    }
  }
  useEffect(() => {
    setData(null);
    setSelected([]);
    load().catch((e) => setError(e.message));
  }, [id]);
  async function action(fn, message) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      if (message) setNotice(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    await action(async () => {
      const a = await api.post(`${base}/albums`, { event_id: eventId });
      setCreating(false);
      navigate(`/operations/galleries/${a.id}`);
    }, "Gallery created.");
  }
  async function upload(files) {
    await action(async () => {
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024)
          throw Error("Each photo must be 10 MB or smaller.");
        await api.post(`${base}/albums/${id}/media`, {
          filename: file.name,
          mime_type: file.type,
          base64: await readFile(file),
        });
      }
    }, "Photos uploaded privately.");
  }
  const bulk = (kind) =>
    action(
      () =>
        api.post(`${base}/albums/${id}/media/bulk`, {
          action: kind,
          media_ids: selected,
          person_id: person || undefined,
        }),
      "Photos updated.",
    );
  const keyFor = (p) =>
    data.keys.find((k) => k.person_id === p && k.status === "ACTIVE");
  const showKey = (k) =>
    action(async () => setAccess(await api.get(`${base}/keys/${k.id}`)));
  const issue = (type, person_id) =>
    action(
      async () =>
        setAccess(
          await api.post(`${base}/albums/${id}/keys`, {
            type,
            person_id,
            expires_at: expiry ? new Date(expiry).toISOString() : null,
          }),
        ),
      "Private access created.",
    );
  const revoke = (k) =>
    action(
      () => api.post(`${base}/keys/${k.id}/revoke`, {}),
      "Access revoked.",
    );
  const regenerate = (k) =>
    action(
      async () =>
        setAccess(await api.post(`${base}/keys/${k.id}/regenerate`, {})),
      "Old code and QR revoked.",
    );
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied.");
    } catch {
      setError("Copy unavailable. Select and copy the link below.");
    }
  };
  return (
    <main className="page gallery-admin">
      <div className="page-heading">
        <div>
          <p className="eyebrow">EXPERIENCE / GALLERIES</p>
          <h1>{data ? data.album.title : "The moments, delivered."}</h1>
          <p className="lede">
            {data
              ? `${formatDateOnly(data.album.event_date)} · Private event gallery`
              : "A beautiful home for every event. Private by design."}
          </p>
        </div>
        <div className="quick-actions">
          {id ? (
            <Link className="secondary-action" to="/operations/galleries">
              <ArrowLeft size={16} />
              All galleries
            </Link>
          ) : (
            <button
              className="primary-action"
              onClick={() => setCreating(true)}
            >
              <Plus size={17} />
              New gallery
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="toast error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="toast">
          {notice}
        </p>
      )}
      {creating && (
        <section className="panel gallery-create">
          <h2>Create an event gallery</h2>
          <RelationshipSelect
            resource="events"
            value={eventId}
            onChange={setEventId}
            placeholder="Event"
          />
          <div className="quick-actions">
            <button
              disabled={!eventId || busy}
              className="primary-action"
              onClick={create}
            >
              Create gallery
            </button>
            <button onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </section>
      )}
      {!id && (
        <div className="album-admin-grid">
          {albums.map((a) => (
            <Link
              className="album-admin-card"
              key={a.id}
              to={`/operations/galleries/${a.id}`}
            >
              <div className="album-cover">
                {a.cover_media_id ? (
                  <GalleryThumbnail id={a.cover_media_id} />
                ) : (
                  <Camera size={38} />
                )}
                <StatusBadge
                  status={a.status === "READY" ? "READY_FOR_REVIEW" : a.status}
                />
              </div>
              <div>
                <p className="eyebrow">{formatDateOnly(a.event_date)}</p>
                <h2>{a.title}</h2>
                <p>
                  {a.photos} photos <span>·</span> {a.people} personal galleries{" "}
                  <ArrowUpRight size={17} />
                </p>
              </div>
            </Link>
          ))}
          {!albums.length && (
            <section className="gallery-empty">
              <Camera size={38} />
              <h2>Every event deserves a gallery.</h2>
              <p>
                Create your first private album, then add the moments worth
                keeping.
              </p>
            </section>
          )}
        </div>
      )}
      {!id && <GalleryImports />}
      {id && !data && !error && <p>Loading gallery…</p>}
      {data && (
        <>
          <div className="gallery-summary">
            <article>
              <span>GALLERY STATUS</span>
              <StatusBadge
                status={
                  data.album.status === "READY"
                    ? "READY_FOR_REVIEW"
                    : data.album.status
                }
              />
            </article>
            <article>
              <span>TOTAL PHOTOS</span>
              <strong>
                {data.media.filter((m) => m.status !== "ARCHIVED").length}
              </strong>
            </article>
            <article>
              <span>PERSONAL GALLERIES</span>
              <strong>{data.people.length}</strong>
            </article>
            <article>
              <span>VIEWS / DOWNLOADS</span>
              <strong>
                {data.activity
                  .filter((a) => a.action.endsWith("OPENED"))
                  .reduce((n, a) => n + a.count, 0)}{" "}
                <small>
                  /{" "}
                  {data.activity
                    .filter((a) => a.action.endsWith("DOWNLOADED"))
                    .reduce((n, a) => n + a.count, 0)}
                </small>
              </strong>
            </article>
          </div>
          <div className="gallery-admin-bar">
            <nav aria-label="Gallery sections">
              {[
                "Overview",
                "Photos",
                "People",
                "Access",
                "Activity",
                "Settings",
              ].map((t) => (
                <button
                  aria-current={tab === t ? "page" : undefined}
                  className={tab === t ? "active" : ""}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </nav>
            <div className="quick-actions">
              <button
                className="secondary-action"
                onClick={() =>
                  data.keys.find(
                    (k) => k.type === "ALBUM" && k.status === "ACTIVE",
                  )
                    ? showKey(
                        data.keys.find(
                          (k) => k.type === "ALBUM" && k.status === "ACTIVE",
                        ),
                      )
                    : issue("ALBUM", null)
                }
              >
                <QrCode size={16} />
                Album QR
              </button>
              <button
                className="primary-action"
                disabled={busy || data.album.status === "PUBLISHED"}
                onClick={() =>
                  action(
                    () =>
                      api.post(`${base}/albums/${id}/status`, {
                        status: "PUBLISHED",
                      }),
                    "Gallery published to authorized guests.",
                  )
                }
              >
                <ArrowUpRight size={16} />
                Publish gallery
              </button>
            </div>
          </div>
          {tab === "Overview" && (
            <GalleryOverview data={data} onTab={setTab} onAccess={setAccess} />
          )}
          {tab === "Photos" && (
            <>
              <div className="gallery-photo-tools">
                <span>
                  {selected.length
                    ? `${selected.length} selected`
                    : "Curate the moments."}
                </span>
                <label className="secondary-action upload-button">
                  <ImagePlus size={16} />
                  {busy ? "Uploading…" : "Upload photos"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif"
                    multiple
                    disabled={busy}
                    onChange={(e) => {
                      upload([...e.target.files]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {!data.storage.configured && (
                <p className="inline-notice">
                  Connect a private staging object-storage bucket to upload
                  photos. Nothing is stored in the public media library.
                </p>
              )}
              {selected.length > 0 && (
                <div className="gallery-bulk-bar">
                  <select
                    aria-label="Assign to personal gallery"
                    value={person}
                    onChange={(e) => setPerson(e.target.value)}
                  >
                    <option value="">Choose person</option>
                    {data.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!person || busy}
                    onClick={() => bulk("assign")}
                  >
                    Assign
                  </button>
                  <button
                    disabled={!person || busy}
                    onClick={() => bulk("unassign")}
                  >
                    Remove assignment
                  </button>
                  {["hide", "restore", "archive"].map((a) => (
                    <button disabled={busy} key={a} onClick={() => bulk(a)}>
                      {a}
                    </button>
                  ))}
                  <button onClick={() => setSelected([])}>Clear</button>
                </div>
              )}
              <div className="admin-photo-grid">
                {data.media.map((m, index) => (
                  <article
                    key={m.id}
                    className={selected.includes(m.id) ? "selected" : ""}
                  >
                    <div className="admin-photo-image">
                      <GalleryThumbnail id={m.id} alt={`Photo ${index + 1}`} />
                      <label className="photo-select">
                        <input
                          type="checkbox"
                          aria-label={`Select photo ${index + 1}`}
                          checked={selected.includes(m.id)}
                          onChange={(e) =>
                            setSelected((current) =>
                              e.target.checked
                                ? [...current, m.id]
                                : current.filter((x) => x !== m.id),
                            )
                          }
                        />
                      </label>
                    </div>
                    <div className="admin-photo-meta">
                      <span>Photo {String(index + 1).padStart(3, "0")}</span>
                      <StatusBadge status={m.status} />
                      <small>
                        {m.mime_type.split("/")[1].toUpperCase()} ·{" "}
                        {m.person_ids.length} people ·{" "}
                        {m.captured_at
                          ? formatTimestamp(m.captured_at)
                          : "Capture time not supplied"}
                      </small>
                      <div className="quick-actions">
                        <button
                          disabled={index === 0 || busy}
                          onClick={() => {
                            const ids = data.media.map((x) => x.id);
                            [ids[index - 1], ids[index]] = [
                              ids[index],
                              ids[index - 1],
                            ];
                            action(() =>
                              api.post(`${base}/albums/${id}/media/bulk`, {
                                action: "reorder",
                                media_ids: ids,
                              }),
                            );
                          }}
                        >
                          Move earlier
                        </button>
                        <button
                          onClick={() =>
                            action(
                              () =>
                                api.patch(`${base}/albums/${id}`, {
                                  cover_media_id: m.id,
                                }),
                              "Cover updated.",
                            )
                          }
                        >
                          Set cover
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {!data.media.length && (
                <section className="gallery-empty">
                  <ImagePlus size={40} />
                  <h2>A blank canvas for a great night.</h2>
                  <p>Upload JPG, PNG or GIF photos, up to 10 MB each.</p>
                </section>
              )}
            </>
          )}
          {tab === "People" && (
            <section className="panel">
              <div className="gallery-person-create">
                <input
                  aria-label="Person name (optional)"
                  value={name}
                  placeholder="Person name (optional)"
                  onChange={(e) => setName(e.target.value)}
                />
                <button
                  className="primary-action"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api.post(`${base}/albums/${id}/people`, {
                        display_name: name,
                      });
                      setName("");
                    }, "Personal gallery created.")
                  }
                >
                  <Users size={16} />
                  Add person
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Photos</th>
                      <th>Access</th>
                      <th>Last viewed</th>
                      <th>Downloads</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.people.map((p) => {
                      const k = keyFor(p.id);
                      return (
                        <tr key={p.id}>
                          <td>{p.display_name}</td>
                          <td>{p.photos}</td>
                          <td>
                            <StatusBadge status={k?.status || "DRAFT"} />
                          </td>
                          <td>{formatTimestamp(k?.last_used_at)}</td>
                          <td>
                            {k?.downloads || 0}
                            <label className="personal-download-control">
                              Photos
                              <select
                                aria-label={`Photo download permission for ${p.display_name}`}
                                value={
                                  p.allow_download === null
                                    ? "inherit"
                                    : String(p.allow_download)
                                }
                                onChange={(e) =>
                                  action(() =>
                                    api.patch(
                                      `${base}/people/${p.id}/downloads`,
                                      {
                                        allow_download:
                                          e.target.value === "inherit"
                                            ? null
                                            : e.target.value === "true",
                                        allow_zip: p.allow_zip,
                                      },
                                    ),
                                  )
                                }
                              >
                                <option value="inherit">Album default</option>
                                <option value="true">Allow</option>
                                <option value="false">Block</option>
                              </select>
                            </label>
                            <label className="personal-download-control">
                              ZIP
                              <select
                                aria-label={`ZIP download permission for ${p.display_name}`}
                                value={
                                  p.allow_zip === null
                                    ? "inherit"
                                    : String(p.allow_zip)
                                }
                                onChange={(e) =>
                                  action(() =>
                                    api.patch(
                                      `${base}/people/${p.id}/downloads`,
                                      {
                                        allow_download: p.allow_download,
                                        allow_zip:
                                          e.target.value === "inherit"
                                            ? null
                                            : e.target.value === "true",
                                      },
                                    ),
                                  )
                                }
                              >
                                <option value="inherit">Album default</option>
                                <option value="true">Allow</option>
                                <option value="false">Block</option>
                              </select>
                            </label>
                          </td>
                          <td>
                            <div className="quick-actions">
                              <button
                                onClick={() =>
                                  k ? showKey(k) : issue("PERSON", p.id)
                                }
                              >
                                <QrCode size={15} />
                                {k ? "Code & QR" : "Create access"}
                              </button>
                              {k && (
                                <>
                                  <button onClick={() => regenerate(k)}>
                                    Regenerate
                                  </button>
                                  <button
                                    className="danger"
                                    onClick={() => revoke(k)}
                                  >
                                    Revoke
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => {
                                  setPerson(p.id);
                                  setTab("Photos");
                                }}
                              >
                                Assign photos
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="note-text">
                <LockKeyhole size={14} /> Personal access only includes assigned
                photos. It never grants the full album.
              </p>
            </section>
          )}
          {tab === "Access" && (
            <section className="panel">
              <h2>Private access, on your terms.</h2>
              <p>
                Create, expire or revoke album and personal access
                independently.
              </p>
              <label>
                Expiration for new keys
                <input
                  type="datetime-local"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </label>
              <button
                className="primary-action"
                onClick={() => issue("ALBUM", null)}
              >
                Create album access
              </button>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Access</th>
                      <th>Status</th>
                      <th>Expires</th>
                      <th>Views</th>
                      <th>Downloads</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.keys.map((k) => (
                      <tr key={k.id}>
                        <td>
                          {k.type === "ALBUM"
                            ? "Entire album"
                            : data.people.find((p) => p.id === k.person_id)
                                ?.display_name || "Personal gallery"}
                        </td>
                        <td>
                          <StatusBadge
                            status={
                              k.expires_at &&
                              Date.parse(k.expires_at) < Date.now()
                                ? "EXPIRED"
                                : k.status
                            }
                          />
                        </td>
                        <td>{formatTimestamp(k.expires_at)}</td>
                        <td>{k.views}</td>
                        <td>{k.downloads}</td>
                        <td>
                          {k.status === "ACTIVE" && (
                            <div className="quick-actions">
                              <button onClick={() => showKey(k)}>
                                Code & QR
                              </button>
                              <button onClick={() => regenerate(k)}>
                                Regenerate
                              </button>
                              <button onClick={() => revoke(k)}>Revoke</button>
                              {expiry && (
                                <button
                                  onClick={() =>
                                    action(
                                      () =>
                                        api.post(
                                          `${base}/keys/${k.id}/extend`,
                                          {
                                            expires_at: new Date(
                                              expiry,
                                            ).toISOString(),
                                          },
                                        ),
                                      "Expiration extended.",
                                    )
                                  }
                                >
                                  Extend
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {tab === "Activity" && (
            <section className="panel">
              <h2>Gallery activity</h2>
              <p>
                Aggregate activity only. No guest names, IP addresses or device
                fingerprints.
              </p>
              <div className="gallery-summary">
                {data.activity.map((a) => (
                  <article key={a.action}>
                    <span>{a.action.replaceAll("_", " ")}</span>
                    <strong>{a.count}</strong>
                  </article>
                ))}
              </div>
            </section>
          )}
          {tab === "Settings" && (
            <section className="panel gallery-settings">
              <h2>Gallery settings</h2>
              <label>
                Gallery title
                <input
                  defaultValue={data.album.title}
                  onBlur={(e) =>
                    e.target.value !== data.album.title &&
                    action(() =>
                      api.patch(`${base}/albums/${id}`, {
                        title: e.target.value,
                      }),
                    )
                  }
                />
              </label>
              <label>
                Album expiration
                <input
                  type="datetime-local"
                  defaultValue={data.album.expires_at?.slice(0, 16) || ""}
                  onBlur={(e) =>
                    action(() =>
                      api.patch(`${base}/albums/${id}`, {
                        expires_at: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      }),
                    )
                  }
                />
              </label>
              {[
                ["allow_download", "Album individual downloads"],
                ["allow_zip", "Album Download All"],
                ["allow_personal_download", "Personal individual downloads"],
                ["allow_personal_zip", "Personal ZIP downloads"],
              ].map(([field, label]) => (
                <label className="checkbox-field" key={field}>
                  <input
                    type="checkbox"
                    checked={data.album[field]}
                    onChange={(e) =>
                      action(() =>
                        api.patch(`${base}/albums/${id}`, {
                          [field]: e.target.checked,
                        }),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
              <p>Published {formatTimestamp(data.album.published_at)}</p>
              <h3>Future capture ingestion</h3>
              <label>
                Source provider
                <input
                  defaultValue={data.album.source_provider || ""}
                  placeholder="Fiesta / Dropbox / FTP"
                  onBlur={(e) =>
                    action(() =>
                      api.patch(`${base}/albums/${id}`, {
                        source_provider: e.target.value || null,
                      }),
                    )
                  }
                />
              </label>
              <label>
                External event identifier
                <input
                  defaultValue={data.album.external_event_id || ""}
                  onBlur={(e) =>
                    action(() =>
                      api.patch(`${base}/albums/${id}`, {
                        external_event_id: e.target.value || null,
                      }),
                    )
                  }
                />
              </label>
              <div className="quick-actions">
                {["PROCESSING", "READY", "DRAFT", "ARCHIVED"].map((status) => (
                  <button
                    key={status}
                    onClick={() =>
                      action(
                        () =>
                          api.post(`${base}/albums/${id}/status`, { status }),
                        "Status updated.",
                      )
                    }
                  >
                    {status.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {access && (
        <div className="modal-backdrop">
          <section
            className="gallery-access-dialog"
            ref={accessDialog}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Private gallery access"
          >
            <button
              className="dialog-close"
              aria-label="Close access dialog"
              onClick={() => setAccess(null)}
            >
              <X />
            </button>
            <p className="eyebrow">
              {access.type === "PERSON" ? "PERSONAL GALLERY" : "ENTIRE ALBUM"}
            </p>
            <h2>A private invitation.</h2>
            <img
              className="access-qr"
              src={access.qr}
              alt="Private gallery QR code"
            />
            <strong className="gallery-code">{access.code}</strong>
            <p>
              Anyone with this code or link can access{" "}
              {access.type === "PERSON"
                ? "this person’s assigned photos"
                : "the approved album"}
              . Share thoughtfully.
            </p>
            <div className="quick-actions">
              <button onClick={() => copy(access.code)}>
                <Copy size={15} />
                Copy code
              </button>
              <button onClick={() => copy(access.url)}>Copy link</button>
              <a href={access.qr} download="LOLA-Gallery-QR.png">
                <Download size={15} />
                Download QR
              </a>
              <a href={access.url} target="_blank" rel="noreferrer">
                Preview ↗
              </a>
            </div>
            <input
              aria-label="Private gallery link"
              readOnly
              value={access.url}
            />
            <label>
              Deliver by email
              <input
                type="email"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Recipient email"
              />
            </label>
            <div className="quick-actions">
              <button
                disabled={!recipient || busy}
                onClick={() =>
                  action(
                    () =>
                      api.post(`${base}/keys/${access.id}/deliver`, {
                        recipient,
                        send: false,
                      }),
                    "Gallery email draft created.",
                  )
                }
              >
                Create email draft
              </button>
              <button
                className="primary-action"
                disabled={!recipient || busy}
                onClick={() =>
                  action(
                    () =>
                      api.post(`${base}/keys/${access.id}/deliver`, {
                        recipient,
                        send: true,
                      }),
                    "Gallery delivered.",
                  )
                }
              >
                Send email
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
