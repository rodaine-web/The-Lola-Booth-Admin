import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Heart,
  LockKeyhole,
  Link2,
  Share2,
  ShoppingCart,
  ChevronRight,
  X,
} from "lucide-react";
import { formatDateOnly } from "../utils/display.js";
import "../styles/keepsakes-gallery.css";
import ProductPreview, {canPreviewKeepsake} from "../components/KeepsakesProductPreview.jsx";
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
  const [keepsakesView, setKeepsakesView] = useState(null), [photoNotice, setPhotoNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setKeepsakesView(null);
    // Commerce is optional and can only enrich an already-authorized gallery.
    // A supplier or checkout outage must never prevent free photo access.
    if (data && type && token && import.meta.env.VITE_APP_ENV !== 'production') {
      fetch(`${API}/keepsakes/access/${type}/${token}`, {signal: controller.signal, credentials: 'omit', cache: 'no-store'})
        .then(response => response.ok ? response.json() : null)
        .then(view => {if (current) setKeepsakesView(view?.enabled ? view : null);})
        .catch(() => {if (current) setKeepsakesView(null);});
    }
    return () => {current = false; controller.abort();};
  }, [type, token, data]);
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
      .then(value=>{setData(value);if(type==='photo')setActive(0);})
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
        <a href="/client">Business client sign in</a>
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
  const keepsakesEnabled = Boolean(keepsakesView?.enabled && selected?.mediaType !== 'VIDEO');
  const selectedAsset = keepsakesView?.assets?.find(asset => (asset.mediaId || asset.id) === selected?.id);
  const keepsakesProducts = (keepsakesView?.products || []).filter(product => product.available === true && product.verified !== false && canPreviewKeepsake(product)
    && selectedAsset && (product.provider === 'DIGITAL' ? selectedAsset.digitalEligible && !selectedAsset.included : selectedAsset.merchandiseEligible));
  const shopPath = product => `/keepsakes/${type}/${token}?${new URLSearchParams({...(product ? {product: product.id} : {}), ...(selected ? {asset: selected.id} : {})})}`;
  const copyPhoto = async () => {
    try {await navigator.clipboard.writeText(window.location.href); setPhotoNotice('Photo link copied.');}
    catch {setPhotoNotice('Copy the photo URL from your browser address bar.');}
  };
  const sharePhoto = async () => {
    if (!navigator.share) return copyPhoto();
    try {await navigator.share({title: data.title || 'Your Lola Booth photo', url: window.location.href});}
    catch (error) {if (error.name !== 'AbortError') setPhotoNotice('Use Copy Link to share this photo.');}
  };
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
              {photo.mediaType === "VIDEO" ? <video src={mediaUrl(photo.url)} muted playsInline preload="metadata" aria-label={`Event video ${index+1}`}/> : (
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
              )}
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
          className={`gallery-lightbox ${keepsakesEnabled ? "keepsakes-lightbox" : ""}`}
          ref={dialog}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${active + 1} of ${data.media.length}`}
          onTouchStart={(e) => {touch.current = e.target.closest('.kg-keepsakes-aside') ? null : e.touches[0].clientX;}}
          onTouchEnd={(e) => {
            if (touch.current === null) return;
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
            {keepsakesEnabled && <span className="kg-counter">{active + 1} of {data.media.length}</span>}
            <button aria-label="Close photo" onClick={() => setActive(null)}>
              <X />
            </button>
          </header>
          {keepsakesEnabled ? <>
            <section className="kg-photo-stage" aria-label="Selected photograph">
              <button className="kg-photo-previous" aria-label="Previous photo" onClick={() => setActive(index => (index - 1 + data.media.length) % data.media.length)}><ArrowLeft/></button>
              <figure><img crossOrigin="anonymous" src={mediaUrl(selected.url)} alt={`Event moment ${active + 1}`}/><figcaption>{selected.filename || 'Your event photo'} <span>· {String(active + 1).padStart(2, '0')} / {String(data.media.length).padStart(2, '0')}</span></figcaption></figure>
              <button className="kg-photo-next" aria-label="Next photo" onClick={() => setActive(index => (index + 1) % data.media.length)}><ArrowRight/></button>
            </section>
            <aside className="kg-keepsakes-aside" aria-label="Photo keepsakes">
              <p className="kg-eyebrow">YOUR EVENT PHOTO</p><h2>The Lola Keepsakes</h2><h3 className="kg-headline">Turn your memory into a wonderful keepsake.</h3><p className="kg-description">Personalized photo gifts, prints and more — all featuring your favorite moment.</p>
              <div className="kg-free-actions">
                {data.allowDownload && <button onClick={() => download(selected.id)} aria-label="Download this photo"><span><Download size={23}/></span>Download</button>}
                <button aria-label="Favorite this photo" aria-pressed={favorites.has(selected.id)} onClick={() => toggleFavorite(selected.id)}><span><Heart size={25} fill={favorites.has(selected.id) ? 'currentColor' : 'none'}/></span>Love</button>
                {type === 'photo' && <><button onClick={sharePhoto} aria-label="Share this photo"><span><Share2 size={23}/></span>Share</button><button onClick={copyPhoto} aria-label="Copy Photo Link"><span><Link2 size={23}/></span>Copy Link</button></>}
              </div>
              {photoNotice && <p className="kg-photo-notice" role="status">{photoNotice}</p>}{error && <p className="kg-photo-notice" role="alert">{error}</p>}
              </aside><section className="kg-collection" aria-label="Personalized keepsakes"><h2>Create your keepsake</h2><p>PERSONALIZED PRODUCTS FEATURING YOUR PHOTO</p><div className="kg-product-grid">{keepsakesProducts.map(product => <article className="kg-product-tile" key={product.id}><ProductPreview product={product} asset={{url:mediaUrl(selected.url),label:selected.filename||"Your photo"}} variant={product.variants?.[0]} compact/><div><strong>{product.title}</strong><small>{keepsakeDescription(product.category)}</small>{Number.isInteger(product.retailCents)&&<strong className="kg-price">{new Intl.NumberFormat("en-US",{style:"currency",currency:product.currency||"USD"}).format(product.retailCents/100)}</strong>}<Link className="kg-view-options" to={shopPath(product)} aria-label={`Customize ${product.title}`}>View options</Link></div></article>)}</div>
              {!keepsakesProducts.some(product=>String(product.category).toLowerCase()==='postcard') && <div className="kg-postcard-pending"><strong>Send a Postcard</strong><small>Back design being prepared · personal messages and font choices coming with the approved artwork</small></div>}
              {!keepsakesProducts.length && <p className="kg-empty-products">Personalized products for this photo are being prepared. Your permitted free photo actions remain available.</p>}
              {keepsakesProducts.length > 0 && <><Link className="kg-all-products" to={shopPath()}><ShoppingCart size={22}/> See All Photo Products</Link><p className="kg-preview-note">Product previews use your selected photo. Review the final layout in the shop.</p></>}
            </section>
          </> : <>
          <button
            className="lightbox-prev"
            aria-label="Previous photo"
            onClick={() =>
              setActive((i) => (i - 1 + data.media.length) % data.media.length)
            }
          >
            <ArrowLeft />
          </button>
          {selected.mediaType === "VIDEO" ? <video controls playsInline src={mediaUrl(selected.url)} aria-label="Selected event video"/> : (
          <img
            crossOrigin="anonymous"
            src={mediaUrl(selected.url)}
            alt={`Event moment ${active + 1}`}
          />
          )}
          <button
            className="lightbox-next"
            aria-label="Next photo"
            onClick={() => setActive((i) => (i + 1) % data.media.length)}
          >
            <ArrowRight />
          </button>
          <footer>
            <span>
              {type==='photo'&&selected.filename?selected.filename+' · ':''}
              {String(active + 1).padStart(2, "0")} /{" "}
              {String(data.media.length).padStart(2, "0")}
            </span>
            <div>
              {type==='photo'&&<button onClick={copyPhoto}>Copy Photo Link</button>}
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
          </>}
        </div>
      )}
    </main>
  );
}


function keepsakeDescription(category) {
  return ({postcard: 'Mail this photo to a loved one', print: 'Professionally printed photos', frame: 'A ready-to-display keepsake', mug: 'Your photo on a ceramic mug', magnet: 'A fun, everyday keepsake', keychain: 'A custom photo keychain', digital: 'Your available original photo', bundle: 'Your available original photos'})[String(category).toLowerCase()] || 'Personalize with your photo';
}
