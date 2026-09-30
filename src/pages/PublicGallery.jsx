import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Heart,
  LockKeyhole,
  X,
} from "lucide-react";
import { formatDateOnly } from "../utils/display.js";
const API = import.meta.env.VITE_API_URL || "/api";
const mediaUrl = (url) => `${API.replace(/\/api$/, "")}${url}`;
async function request(path, options) {
  const r = await fetch(`${API}/gallery${path}`, options),
    data = await r.json();
  if (!r.ok)
    throw Error(
      data.error?.message ||
        "This gallery is unavailable. Please contact your host.",
    );
  return data;
}
export default function PublicGallery() {
  const { type, token } = useParams(),
    navigate = useNavigate();
  const [data, setData] = useState(null),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(null),
    [favorites, setFavorites] = useState(new Set());
  const dialog = useRef(),
    touch = useRef(null),
    previousFocus = useRef();
  useEffect(() => {
    const previous = document.title;
    document.title = "Your Photos | The LOLA Booth";
    return () => {
      document.title = previous;
    };
  }, []);
  const access = `/access/${type}/${token}`;
  const refresh = () =>
    request(access + "/refresh")
      .then(setData)
      .catch((e) => {
        setData(null);
        setActive(null);
        setError(e.message);
      });
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 45000);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [type, token]);
  const load = () => {
    setError("");
    request(access)
      .then(setData)
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    setData(null);
    setActive(null);
    if (token) load();
  }, [type, token]);
  useEffect(() => {
    if (active === null) return;
    previousFocus.current = document.activeElement;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    function key(e) {
      if (e.key === "Escape") setActive(null);
      if (e.key === "ArrowRight") setActive((i) => (i + 1) % data.media.length);
      if (e.key === "ArrowLeft")
        setActive((i) => (i - 1 + data.media.length) % data.media.length);
      if (e.key === "Tab") {
        const nodes = [...dialog.current.querySelectorAll("button,a")].filter(
          (x) => !x.disabled,
        );
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    }
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", key);
      previousFocus.current?.focus();
    };
  }, [active !== null, data?.media.length]);
  async function resolve(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await request("/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      navigate(r.path);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function download(id) {
    try {
      const r = await request(`${access}/media/${id}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      window.location.assign(mediaUrl(r.url));
    } catch (e) {
      setError(e.message);
    }
  }
  const toggleFavorite = (id) =>
    setFavorites((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const logo = (
    <img
      className="gallery-wordmark"
      src="/brand/LOLA_Horizontal_Light_Transparent.png"
      alt="The LOLA Booth"
    />
  );
  if (!token)
    return (
      <main className="gallery-entry">
        {logo}
        <div className="gallery-entry-card">
          <LockKeyhole size={22} />
          <p className="eyebrow">PRIVATE MOMENTS. BEAUTIFULLY KEPT.</p>
          <h1>
            Your photos
            <br />
            are waiting.
          </h1>
          <p>
            A little reminder of a very good time.
            <br />
            Enter the code shared by your host.
          </p>
          <form onSubmit={resolve}>
            <label htmlFor="gallery-code">Your gallery code</label>
            <input
              id="gallery-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXXX–XXXXX–XXXXX–XXXXX"
              autoComplete="off"
              maxLength={40}
              required
            />
            <button className="primary-action" disabled={busy}>
              {busy ? "Opening…" : "OPEN GALLERY"}
              <ArrowRight size={17} />
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
          <p className="gallery-privacy-note">
            Private galleries. No public images.
            <br />A Gallery QR opens your photos directly.
          </p>
        </div>
        <footer>GOOD PEOPLE. BETTER PHOTOS.</footer>
      </main>
    );
  if (!data)
    return (
      <main className="gallery-entry">
        {logo}
        <h1>{error ? "A private moment." : "Opening your gallery…"}</h1>
        <p role={error ? "alert" : undefined}>
          {error || "Your photos will be here shortly."}
        </p>
        {error && (
          <>
            <a href="/gallery">Enter another code</a>
            <a href="mailto:info@thelolabooth.com">Contact The LOLA Booth</a>
          </>
        )}
      </main>
    );
  const selected = active === null ? null : data.media[active];
  return (
    <main
      className={`customer-gallery ${data.type === "PERSON" ? "personal" : "album"}`}
    >
      <header className="gallery-top">
        {logo}
        <span>
          <LockKeyhole size={13} />
          Private gallery
        </span>
      </header>
      <section className="gallery-intro">
        <p className="eyebrow">
          {data.type === "PERSON" ? "JUST FOR YOU" : "THE MOMENTS THAT MATTER"}
        </p>
        <h1>{data.title}</h1>
        <p>
          {data.type === "PERSON"
            ? "Your moments from the event."
            : formatDateOnly(data.eventDate)}
        </p>
        {data.type === "PERSON" && (
          <small>
            {data.eventName} · {formatDateOnly(data.eventDate)}
          </small>
        )}
        <span className="gold-rule" />
      </section>
      <div className="gallery-toolbar">
        <span>{data.media.length} moments</span>
        {data.allowZip && (
          <a className="secondary-action" href={`${API}/gallery${access}/zip`}>
            <Download size={16} />
            {data.type === "PERSON" ? "Download your photos" : "Download all"}
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <section className="customer-photo-grid" aria-label="Photos">
        {data.media.map((photo, index) => (
          <article key={photo.id}>
            <button
              className="photo-open"
              aria-label={`Open photo ${index + 1}`}
              onClick={() => setActive(index)}
            >
              <img
                crossOrigin="anonymous"
                src={mediaUrl(photo.url)}
                alt={`Event moment ${index + 1}`}
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.alt =
                    "Preview unavailable. Use Refresh gallery to try again.";
                }}
              />
            </button>
            <div className="photo-actions">
              <button
                aria-label={`Favorite photo ${index + 1}`}
                aria-pressed={favorites.has(photo.id)}
                onClick={() => toggleFavorite(photo.id)}
              >
                <Heart
                  size={18}
                  fill={favorites.has(photo.id) ? "currentColor" : "none"}
                />
              </button>
              {data.allowDownload && (
                <button
                  aria-label={`Download photo ${index + 1}`}
                  onClick={() => download(photo.id)}
                >
                  <Download size={18} />
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
      {!data.media.length && (
        <div className="gallery-empty">
          <h2>Your moments are on their way.</h2>
          <p>Your host will add approved photos here.</p>
        </div>
      )}
      <footer className="gallery-footer">
        THE LOLA BOOTH <span>Good people. Better photos.</span>
        <button onClick={load}>Refresh gallery</button>
      </footer>
      {selected && (
        <div
          className="gallery-lightbox"
          ref={dialog}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${active + 1} of ${data.media.length}`}
          onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - touch.current;
            if (Math.abs(dx) > 50)
              setActive(
                (i) =>
                  (i + (dx < 0 ? 1 : -1) + data.media.length) %
                  data.media.length,
              );
          }}
        >
          <header>
            <span>THE LOLA BOOTH</span>
            <button aria-label="Close photo" onClick={() => setActive(null)}>
              <X />
            </button>
          </header>
          <button
            className="lightbox-prev"
            aria-label="Previous photo"
            onClick={() =>
              setActive((i) => (i - 1 + data.media.length) % data.media.length)
            }
          >
            <ArrowLeft />
          </button>
          <img
            crossOrigin="anonymous"
            src={mediaUrl(selected.url)}
            alt={`Event moment ${active + 1}`}
          />
          <button
            className="lightbox-next"
            aria-label="Next photo"
            onClick={() => setActive((i) => (i + 1) % data.media.length)}
          >
            <ArrowRight />
          </button>
          <footer>
            <span>
              {String(active + 1).padStart(2, "0")} /{" "}
              {String(data.media.length).padStart(2, "0")}
            </span>
            <div>
              <button
                aria-label="Favorite this photo"
                aria-pressed={favorites.has(selected.id)}
                onClick={() => toggleFavorite(selected.id)}
              >
                <Heart
                  fill={favorites.has(selected.id) ? "currentColor" : "none"}
                />
              </button>
              {data.allowDownload && (
                <button onClick={() => download(selected.id)}>
                  <Download size={18} /> Download
                </button>
              )}
            </div>
          </footer>
        </div>
      )}
    </main>
  );
}
