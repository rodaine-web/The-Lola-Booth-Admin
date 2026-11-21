import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Download, Image, LockKeyhole, Minus, Package, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import "../styles/keepsakes.css";
import {POSTCARD_FONTS,POSTCARD_COLORS,DEFAULT_MESSAGE_FONT,DEFAULT_MESSAGE_COLOR} from "../../shared/postcard-message-styles.js";

const API = import.meta.env.VITE_API_URL || "/api";
const EMPTY_ADDRESS = { name: "", address1: "", address2: "", city: "", state: "", zip: "", country: "US" };
const INITIAL_CROP = { zoom: 1, x: 0.5, y: 0.5, fit: "contain" };
const money = (cents, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(cents || 0) / 100);
const mediaUrl = (url) => !url ? "" : url.startsWith("/api/") ? `${API.replace(/\/api$/, "")}${url}` : url;
const labelStatus = (value) => String(value || "Pending").replaceAll("_", " ").toLowerCase();
const category = (product) => String(product?.category || "print").toLowerCase();
const isDigital = (product) => /digital|bundle/.test(category(product));
const isPostcard = (product) => /postcard/.test(category(product)) || product?.provider === "LOB";
const issueText = (issue) => typeof issue === "string" ? issue : issue?.message || issue?.code || "Please review this order.";

async function request(path, body, signal) {
  const response = await fetch(`${API}/keepsakes${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Keepsakes is temporarily unavailable. Your free gallery remains available.");
  return data;
}

function AddressFields({ value, onChange, prefix, recipient = false }) {
  const field = (key, label, extra = {}) => <label className={key === "name" || key === "address1" || key === "address2" ? "ks-field-wide" : ""} htmlFor={`${prefix}-${key}`}>
    {label}<input id={`${prefix}-${key}`} name={`${prefix}-${key}`} value={value[key] || ""} onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      autoComplete={recipient ? "off" : ({ name: "shipping name", address1: "shipping address-line1", address2: "shipping address-line2", city: "shipping address-level2", state: "shipping address-level1", zip: "shipping postal-code", country: "shipping country" })[key]}
      maxLength={key === "country" ? 2 : 200} required={key !== "address2"} {...extra} />
  </label>;
  return <div className="ks-address-fields">
    {field("name", "Full name")}{field("address1", "Street address")}{field("address2", "Apartment / suite (optional)")}
    {field("city", "City")}{field("state", "State / province")}{field("zip", "ZIP / postal code")}{field("country", "Country code", { pattern: "[A-Za-z]{2}", title: "Two-letter country code, for example US" })}
  </div>;
}

function ProductPreview({ product, asset, variant, crop = INITIAL_CROP, compact = false }) {
  const kind = category(product), shape = /mug/.test(kind) ? "mug" : /frame/.test(kind) ? "frame" : /magnet/.test(kind) ? "magnet" : /postcard/.test(kind) ? "postcard" : /digital|bundle/.test(kind) ? "digital" : "print";
  if (shape === "mug" && variant?.sku === "GLOBAL-MUG-W") return <div className={`ks-product-stage ks-stage-mug ${compact ? "ks-stage-compact" : ""}`} aria-label={`${product?.title || "Photo"} preview`}>
    <div className="ks-mug-scene">
      <img className="ks-mug-blank" src="/assets/keepsakes/prodigi-white-mug-11oz.png" alt="" aria-hidden="true" />
      <div className="ks-preview-art ks-mug-art">
        {asset?.url ? <img crossOrigin="anonymous" src={mediaUrl(asset.url)} alt={compact ? "" : `${asset.label || "Selected photo"} on ${product?.title || "product"}`}
          style={{objectFit: crop.fit === "cover" ? "cover" : "contain", objectPosition: `${crop.x * 100}% ${crop.y * 100}%`, transform: `scale(${crop.zoom})`, transformOrigin: `${crop.x * 100}% ${crop.y * 100}%`}} /> : <Image aria-hidden="true" />}
      </div>
      <img className="ks-mug-lighting" src="/assets/keepsakes/prodigi-white-mug-11oz.png" alt="" aria-hidden="true" />
    </div>
    {!compact ? <span className="ks-preview-caption">Prodigi product photo · placement illustration, not a printer proof</span> : null}
  </div>;
  return <div className="ks-product-stage ks-supplier-pending" aria-label={`${product?.title || 'Photo'} preview`}>
    {isDigital(product) && asset?.url ? <img crossOrigin="anonymous" src={mediaUrl(asset.url)} alt="Selected original photograph"/> : <><Image aria-hidden="true"/><p>{shape==='postcard'?'Your postcard design will appear here':'Supplier product image being prepared'}</p></>}
  </div>;
}

function PostcardContent({ recipient }) {
  return <div className="ks-postcard-content" aria-label="Message and address preview">
    <small>MESSAGE & ADDRESS PREVIEW</small>
    <div><p style={{fontFamily:POSTCARD_FONTS.find(f=>f.id===(recipient.messageFont||DEFAULT_MESSAGE_FONT))?.family,color:recipient.messageColor||DEFAULT_MESSAGE_COLOR}}>{recipient.message || "Your personal message will appear here."}</p><address>{recipient.name || "Recipient name"}<br />{recipient.address1 || "Street address"}{recipient.address2 ? <><br />{recipient.address2}</> : null}<br />{[recipient.city, recipient.state, recipient.zip].filter(Boolean).join(", ") || "City, state and postal code"}<br />{recipient.country}</address></div>
  </div>;
}

function Quantity({ value, onChange, disabled = false }) {
  return <div className="ks-quantity"><button type="button" aria-label="Decrease quantity" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)}><Minus size={16} /></button><output aria-label="Quantity">{value}</output><button type="button" aria-label="Increase quantity" disabled={disabled || value >= 20} onClick={() => onChange(value + 1)}><Plus size={16} /></button></div>;
}

function PrintLayoutReview({ quote, reviewed, onReview }) {
  return <section className="ks-print-layout-review" aria-labelledby="ks-print-layout-title">
    <h3 id="ks-print-layout-title">Review print layouts</h3>
    <p>These reduced previews show the saved print layouts for this quote. Supplier rendering and production checks follow payment.</p>
    <div className="ks-print-layout-grid">{quote.proofs.map((proof, index) => <figure key={`${proof.url}-${index}`}>
      <img crossOrigin="anonymous" src={mediaUrl(proof.url)} alt={`${proof.label || `Item ${Number(proof.itemIndex ?? 0) + 1}`} — ${proof.side || 'print'} layout`} loading="lazy" referrerPolicy="no-referrer" onError={event => {event.currentTarget.alt = 'Print layout unavailable. Recalculate your quote to try again.';}} />
      <figcaption><strong>{proof.label || `Item ${Number(proof.itemIndex ?? 0) + 1}`}</strong><span>{proof.side === 'back' ? 'Back' : proof.side === 'front' ? 'Front' : 'Print layout'}{Number.isInteger(proof.recipientIndex) ? ` · Recipient ${proof.recipientIndex + 1}` : ''}</span>{proof.side === 'back' ? <p>The printer adds the recipient address and postage in the reserved area.</p> : null}</figcaption>
    </figure>)}</div>
    <label className="ks-proof-review-check"><input type="checkbox" checked={reviewed} onChange={event => onReview(event.target.checked)}/><span>I reviewed these print layouts and recipient details</span></label>
    <p className="ks-print-layout-note">Changes to your items, contact details or quote require another review.</p>
  </section>;
}

function KeepsakesStore({ type, token }) {
  const access = `/access/${encodeURIComponent(type)}/${encodeURIComponent(token)}`;
  const [data, setData] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [productId, setProductId] = useState(""), [variantId, setVariantId] = useState(""), [assetIds, setAssetIds] = useState([]), [quantity, setQuantity] = useState(1), [crop, setCrop] = useState(INITIAL_CROP);
  const [cart, setCart] = useState([]), [cartOpen, setCartOpen] = useState(false), [editing, setEditing] = useState(null), [recipients, setRecipients] = useState([{ ...EMPTY_ADDRESS, message: "" }]);
  const [email, setEmail] = useState(""), [shippingAddress, setShippingAddress] = useState(EMPTY_ADDRESS), [quote, setQuote] = useState(null);
  const [reviewedQuote, setReviewedQuote] = useState(null);
  const proofReviewed = quote !== null && reviewedQuote === quote;
  const hasPhysicalProofs = Array.isArray(quote?.proofs) && quote.proofs.length > 0;
  const panel = useRef(null), quoteForm = useRef(null), noticeRef = useRef(null);
  useEffect(() => {
    const abort = new AbortController();
    request(access, undefined, abort.signal).then((value) => {
      setData(value);
      const selection=new URLSearchParams(window.location.search);
      const first = value.products?.find((p) => p.available&&p.id===selection.get('product'))||value.products?.find((p) => p.available);
      setProductId(first?.id || ""); setVariantId(first?.variants?.[0]?.id || "");
      const allowed=(value.assets||[]).filter(asset=>isDigital(first)?asset.digitalEligible&&!asset.included:asset.merchandiseEligible===true);
      const firstAsset=allowed.find(asset=>asset.id===selection.get('asset')||asset.mediaId===selection.get('asset'))||allowed[0];
      setAssetIds(firstAsset ? [firstAsset.id] : []);
    }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => abort.abort();
  }, [access]);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      request(access, undefined, abort.signal).then(setData).catch((e) => {
        if (e.name !== "AbortError") { setError(e.message); setData(null); setQuote(null); }
      });
    };
    const timer = setInterval(refresh, 45000);
    document.addEventListener("visibilitychange", refresh);
    return () => { abort.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [access]);
  useEffect(() => { const old = document.title; document.title = "The Lola Keepsakes | Your moment, beautifully kept"; return () => { document.title = old; }; }, []);
  useEffect(() => {
    if (!cartOpen) return;
    const previous = document.activeElement, before = document.body.style.overflow;
    document.body.style.overflow = "hidden"; panel.current?.focus();
    const key = (e) => {
      if (e.key === "Escape" && !busy) setCartOpen(false);
      if (e.key !== "Tab") return;
      const elements = [...(panel.current?.querySelectorAll("button,a,input,select,textarea") || [])].filter((el) => !el.disabled && el.getClientRects().length);
      const first = elements[0], last = elements.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = before; window.removeEventListener("keydown", key); previous?.focus(); };
  }, [cartOpen, busy]);
  const products = (data?.products || []).filter((p) => p.available), assets = data?.assets || [];
  const product = products.find((p) => p.id === productId), variant = product?.variants?.find((v) => v.id === variantId) || product?.variants?.[0];
  const bundle = /bundle/.test(category(product)), digital = isDigital(product), postcard = isPostcard(product);
  const eligible = assets.filter((asset) => digital ? asset.digitalEligible && !asset.included : asset.merchandiseEligible===true);
  const selectedAssets = eligible.filter((asset) => assetIds.includes(asset.id)), selectedAsset = selectedAssets[0];
  const requiresShipping = cart.some((item) => { const p = products.find((p) => p.id === item.productId); return p && !isDigital(p) && !isPostcard(p); });
  const amount = cart.reduce((sum, item) => sum + Number(products.find((p) => p.id === item.productId)?.retailCents || 0) * item.quantity * (item.recipients?.length || 1), 0);
  const spec = variant?.printSpec, requiredWidth = Number(spec?.widthPx), requiredHeight = Number(spec?.heightPx);
  const inset=2*(Number(spec?.bleedPx||0)+Number(spec?.safePx||0));
  const ratio=selectedAsset&&Math[crop.fit==='cover'?'max':'min']((requiredWidth-inset)/selectedAsset.width,(requiredHeight-inset)/selectedAsset.height)*crop.zoom;
  const lowResolution = !digital && selectedAsset && requiredWidth && requiredHeight && ratio>1;
  const currency = product?.currency || "USD";
  function chooseProduct(next) {
    setProductId(next.id); setVariantId(next.variants?.[0]?.id || ""); setQuantity(1); setCrop(INITIAL_CROP); setEditing(null); setError("");
    const allowed = assets.filter((a) => isDigital(next)?a.digitalEligible&&!a.included:a.merchandiseEligible===true);
    setAssetIds(allowed.some((a) => a.id === assetIds[0]) ? [assetIds[0]] : allowed[0] ? [allowed[0].id] : []);
  }
  function updateCart(next) { setCart(next); setQuote(null); }
  function addItem(e) {
    e.preventDefault();
    if (!product || !variant || !selectedAssets.length || !data.enabled) return;
    if (postcard && !e.currentTarget.reportValidity()) return;
    const item = { productId: product.id, variantId: variant.id, assetIds: selectedAssets.map((a) => a.id), quantity: digital ? 1 : quantity, customization: { ...crop }, ...(postcard ? { recipients: recipients.map((r) => ({ ...r })) } : {}) };
    if (editing !== null) { updateCart(cart.map((row, index) => index === editing ? item : row)); setNotice("Your keepsake has been updated."); }
    else { updateCart([...cart, item]); setNotice(`${product.title} added to your cart.`); }
    setEditing(null); requestAnimationFrame(() => noticeRef.current?.focus());
  }
  function editItem(index) {
    setQuote(null); setReviewedQuote(null);
    const item = cart[index]; setProductId(item.productId); setVariantId(item.variantId); setAssetIds(item.assetIds); setQuantity(item.quantity); setCrop(item.customization); setRecipients(item.recipients || [{ ...EMPTY_ADDRESS, message: "" }]); setEditing(index); setCartOpen(false); setNotice("Editing your keepsake. Save your changes below."); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function getQuote(e) {
    e.preventDefault(); setBusy(true); setError(""); setQuote(null);
    try { setQuote(await request(`${access}/quote`, { items: cart, email, shippingAddress })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function checkout() {
    if (!quote?.checkoutReady || !data.readiness?.checkout || (hasPhysicalProofs && !proofReviewed)) return;
    setBusy(true); setError("");
    try {
      const next = await request(`${access}/checkout`, { quoteId: quote.quoteId, proofReviewed });
      const destination = new URL(next.url);
      if (destination.protocol !== "https:" || !["checkout.stripe.com", "buy.stripe.com"].includes(destination.hostname)) throw Error("The secure checkout link is unavailable. Please try again.");
      window.location.assign(destination.href);
    } catch (e) { setError(e.message); setBusy(false); }
  }
  function updateContact(fn) { fn(); setQuote(null); }
  const galleryPath = `/gallery/${encodeURIComponent(type)}/${encodeURIComponent(token)}`;
  return <main className="ks-store">
    <header className="ks-header"><Link className="ks-brand" to={galleryPath}>THE LOLA BOOTH</Link><div className="ks-brand-title"><h1><em>The Lola</em> Keepsakes</h1><p>TURN YOUR FAVORITE MOMENT INTO A LASTING KEEPSAKE</p></div><button className="ks-cart-button" onClick={() => setCartOpen(true)}><ShoppingCart size={24} /> Cart ({cart.reduce((n, item) => n + item.quantity, 0)})</button></header>
    <div className="ks-subnav"><Link to={galleryPath}><ArrowLeft size={15} /> Back to your photos</Link><span>{data?.album?.title || "Your private photo experience"}</span><span><LockKeyhole size={13} /> Secure guest checkout</span></div>
    {error && !cartOpen ? <p className="ks-alert ks-error" role="alert">{error}</p> : null}
    {notice ? <p ref={noticeRef} tabIndex={-1} className="ks-alert ks-success" role="status"><Check size={16} />{notice}<button onClick={() => setCartOpen(true)}>View cart <ArrowRight size={15} /></button></p> : null}
    {!data ? <section className="ks-empty"><Package size={32} /><h2>{error ? "Your keepsakes are unavailable" : "Opening your keepsakes…"}</h2><p>{error ? "You can still return to your gallery to view and download the photos included with your event." : "Finding the products and photos available for your event."}</p></section> : !data.enabled || !products.length ? <section className="ks-empty"><Image size={36} /><p className="ks-eyebrow">YOUR MOMENT, BEAUTIFULLY KEPT</p><h2>{data.enabled ? "Keepsakes are being prepared" : "Enjoy your photos"}</h2><p>{data.enabled ? "There are no verified products available for this event yet. Please check back or contact your host." : "Shopping is not enabled for this event. Your existing gallery and included downloads are still available."}</p><Link className="ks-gold-button" to={galleryPath}>Return to your gallery <ArrowRight size={18} /></Link></section> : <>
      <section className="ks-shop-grid" aria-label="Personalize your keepsake">
        <aside className="ks-photo-panel"><p className="ks-eyebrow">A LITTLE SOMETHING TO KEEP</p><h2>Your photos</h2><p>Choose a real photo from your session to make it yours.</p><div className="ks-photo-list" aria-label="Available session photos">{eligible.map((asset) => <button type="button" key={asset.id} aria-pressed={assetIds.includes(asset.id)} onClick={() => setAssetIds((current) => bundle ? current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id] : [asset.id])}>
          <img crossOrigin="anonymous" src={mediaUrl(asset.url)} alt="" loading="lazy" /><span>{asset.label}<small>{String(asset.kind || "Photo").replaceAll("_", " ").toLowerCase()}</small></span>{assetIds.includes(asset.id) ? <Check size={19} /> : <i aria-hidden="true" />}
        </button>)}</div>{!eligible.length ? <p className="ks-alert">No eligible files are available for this product. Files already included with your event are never charged again.</p> : null}<p className="ks-photo-note">Only the actual files available for your session appear here.</p></aside>
        <div className="ks-preview-panel"><ProductPreview product={product} asset={selectedAsset} variant={variant} crop={crop} />{selectedAsset ? <div className="ks-preview-meta"><span>{selectedAsset.label}</span><span>{selectedAsset.width && selectedAsset.height ? `${selectedAsset.width.toLocaleString()} × ${selectedAsset.height.toLocaleString()} px` : "Resolution checked before checkout"}</span></div> : null}</div>
        <form className="ks-customizer" onSubmit={addItem}><p className="ks-script">Make it yours</p><h2>{product?.title}</h2><p className="ks-product-description">{digital ? bundle ? "Keep the original files you select, together in one digital bundle." : "Your available original photograph, ready to download after payment." : postcard ? "A personal hello, printed and mailed to someone special." : "A favorite moment, made into something you can hold."}</p>
          <fieldset><legend>{bundle ? "Choose your photos" : "Choose your photo"}</legend><div className="ks-photo-swatches">{eligible.map((asset) => <button type="button" key={asset.id} aria-label={`Select ${asset.label}`} aria-pressed={assetIds.includes(asset.id)} onClick={() => setAssetIds((current) => bundle ? current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id] : [asset.id])}><img crossOrigin="anonymous" src={mediaUrl(asset.url)} alt="" loading="lazy" /><span>{asset.label}</span></button>)}</div></fieldset>
          {product?.variants?.length ? <fieldset><legend>Choose an option</legend><div className="ks-variants">{product.variants.map((v) => <button type="button" key={v.id} aria-pressed={variant?.id === v.id} onClick={() => setVariantId(v.id)}>{v.color ? <i style={{ background: v.color }} aria-hidden="true" /> : null}{v.label}</button>)}</div></fieldset> : null}
          {!digital && variant?.printSpec?.customizationVerified === true ? <details className="ks-adjustments"><summary>Adjust your photo</summary><label htmlFor="ks-fit">Photo layout<select id="ks-fit" aria-label="Photo layout" value={crop.fit} onChange={(e) => setCrop({ ...crop, fit: e.target.value })}><option value="contain">Keep the complete photo</option><option value="cover">Fill the print area (crops edges)</option></select></label><label htmlFor="ks-zoom">Zoom <output>{crop.zoom.toFixed(2)}×</output><input id="ks-zoom" type="range" min="1" max="3" step="0.05" value={crop.zoom} onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })} /></label><label htmlFor="ks-x">Horizontal position<input id="ks-x" type="range" min="0" max="1" step="0.01" value={crop.x} onChange={(e) => setCrop({ ...crop, x: Number(e.target.value) })} /></label><label htmlFor="ks-y">Vertical position<input id="ks-y" type="range" min="0" max="1" step="0.01" value={crop.y} onChange={(e) => setCrop({ ...crop, y: Number(e.target.value) })} /></label><button type="button" className="ks-text-button" onClick={() => setCrop(INITIAL_CROP)}>Reset adjustments</button></details> : null}
          {lowResolution ? <p className="ks-alert" role="status">This photo may be too small at the current zoom. Final artwork resolution is checked before payment.</p> : null}
          {postcard ? <div className="ks-recipients"><h3>Who is it for?</h3><p>Each recipient receives the selected photo with their own message.</p>{recipients.map((recipient, index) => <fieldset className="ks-recipient" key={index}><legend>Recipient {index + 1}</legend><AddressFields prefix={`ks-recipient-${index}`} value={recipient} recipient onChange={(next) => setRecipients((current) => current.map((r, i) => i === index ? next : r))} /><label htmlFor={`ks-message-${index}`}>Your message (optional)<textarea id={`ks-message-${index}`} value={recipient.message} maxLength={500} onChange={(e) => setRecipients((current) => current.map((r, i) => i === index ? { ...r, message: e.target.value } : r))} /></label><div className="ks-message-options"><label htmlFor={`ks-message-font-${index}`}>Message font<select aria-label="Message font" id={`ks-message-font-${index}`} value={recipient.messageFont||DEFAULT_MESSAGE_FONT} onChange={e=>setRecipients(current=>current.map((r,i)=>i===index?{...r,messageFont:e.target.value}:r))}>{POSTCARD_FONTS.map(font=><option key={font.id} value={font.id}>{font.label}</option>)}</select></label><label htmlFor={`ks-message-color-${index}`}>Font color<select aria-label="Font color" id={`ks-message-color-${index}`} value={recipient.messageColor||DEFAULT_MESSAGE_COLOR} onChange={e=>setRecipients(current=>current.map((r,i)=>i===index?{...r,messageColor:e.target.value}:r))}>{POSTCARD_COLORS.map(color=><option key={color.value} value={color.value}>{color.label}</option>)}</select></label></div><PostcardContent recipient={recipient} />{recipients.length > 1 ? <button type="button" className="ks-text-button" onClick={() => setRecipients((current) => current.filter((_, i) => i !== index))}>Remove recipient {index + 1}</button> : null}</fieldset>)}<button type="button" className="ks-outline-button" disabled={recipients.length >= 10} onClick={() => setRecipients((current) => [...current, { ...EMPTY_ADDRESS, message: "" }])}><Plus size={15} /> Add another recipient</button></div> : null}
          <div className="ks-buy-row"><div><label>Quantity</label><Quantity value={digital ? 1 : quantity} disabled={digital} onChange={setQuantity} /></div><div className="ks-price"><span>{postcard && recipients.length > 1 ? `${recipients.length} recipients · each` : "Product price"}</span><strong>{money(product?.retailCents, currency)}</strong></div></div>
          <button className="ks-gold-button ks-add" type="submit" disabled={!selectedAssets.length || !variant || !data.enabled}><ShoppingCart size={22} />{editing === null ? "Add to cart" : "Save changes"}</button><p className="ks-checkout-note">{digital ? "Secure download access follows verified payment." : "Shipping and applicable taxes are confirmed before payment."}</p>
          {editing !== null ? <button type="button" className="ks-text-button" onClick={() => { setEditing(null); setNotice(""); }}>Cancel editing</button> : null}
        </form>
      </section>
      {!products.some(isPostcard) && <section className="ks-postcard-coming" aria-label="Postcard availability"><h2>Send a Postcard</h2><p>Your event’s postcard back design is being prepared. Once it is uploaded and approved, you can add a personal message and choose from five typed or handwriting fonts and five ink colors.</p><span>Artwork pending · ordering unavailable</span></section>}
      <section className="ks-more-products"><div><p className="ks-eyebrow">YOUR PHOTO. MORE POSSIBILITIES.</p><h2>More keepsake ideas</h2><p>Explore the products available for your event.</p></div><div className="ks-product-grid">{products.map((next) => <button className="ks-product-card" key={next.id} aria-pressed={next.id === productId} onClick={() => chooseProduct(next)}><ProductPreview product={next} asset={assets.find((a) => a.id === assetIds[0]) || assets[0]} variant={next.variants?.[0]} compact /><span><strong>{next.title}</strong><small>{money(next.retailCents, next.currency)}</small><ChevronRight size={22} /></span></button>)}</div></section>
    </>}
    <footer className="ks-footer"><span>THE LOLA BOOTH</span><p>Photo experiences for meaningful moments.</p><a href="mailto:info@thelolabooth.com">Need a hand?</a></footer>
    {cartOpen ? <div className="ks-cart-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) setCartOpen(false); }}><section className="ks-cart-panel" ref={panel} role="dialog" aria-modal="true" aria-label="Your keepsakes cart" tabIndex={-1}><header><div><p className="ks-eyebrow">YOUR MOMENTS, READY TO KEEP</p><h2>Your cart</h2></div><button aria-label="Close cart" disabled={busy} onClick={() => setCartOpen(false)}><X /></button></header>
      {error ? <p className="ks-alert ks-error" role="alert">{error}</p> : null}
      {!cart.length ? <div className="ks-empty"><ShoppingCart size={35} /><h3>Your cart is waiting for a moment.</h3><p>Choose a photo and a keepsake to start.</p><button className="ks-gold-button" onClick={() => setCartOpen(false)}>Keep exploring <ArrowRight size={18} /></button></div> : <>
        <ul className="ks-cart-items">{cart.map((item, index) => { const p = products.find((p) => p.id === item.productId), a = assets.find((a) => a.id === item.assetIds[0]), v = p?.variants?.find((v) => v.id === item.variantId); return <li key={index}><ProductPreview product={p} asset={a} variant={v} crop={item.customization} compact /><div><h3>{p?.title || "Keepsake"}</h3><p>{v?.label} · {item.assetIds.length > 1 ? `${item.assetIds.length} photos` : a?.label}</p><p>Quantity {item.quantity}{item.recipients?.length ? ` · ${item.recipients.length} recipient${item.recipients.length > 1 ? "s" : ""}` : ""}</p><strong>{money(Number(p?.retailCents || 0) * item.quantity * (item.recipients?.length || 1), p?.currency)}</strong><div className="ks-cart-item-actions"><button disabled={busy} onClick={() => editItem(index)}>Edit item {index + 1}</button><button aria-label={`Remove item ${index + 1}`} disabled={busy} onClick={() => updateCart(cart.filter((_, i) => i !== index))}><Trash2 size={14} />Remove</button></div></div></li>; })}</ul>
        <div className="ks-cart-subtotal"><span>Product subtotal</span><strong>{money(amount, products.find((p) => p.id === cart[0]?.productId)?.currency)}</strong></div>
        <form ref={quoteForm} onSubmit={getQuote} className="ks-checkout-form"><h3>Delivery details</h3><label htmlFor="ks-email">Email for your order updates<input id="ks-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => updateContact(() => setEmail(e.target.value))} /></label><h4>{requiresShipping ? "Shipping address" : "Billing address for tax"}</h4><AddressFields prefix="ks-shipping" value={shippingAddress} onChange={(next) => updateContact(() => setShippingAddress(next))} />{!requiresShipping && <p>This address determines applicable tax. Postcards use the recipients saved on each item; digital purchases need no shipment.</p>}<button type="submit" className="ks-outline-button" disabled={busy}>{busy ? "Checking your order…" : "Calculate shipping & tax"}</button></form>
        {quote ? <div className="ks-quote" aria-live="polite"><h3>Your order total</h3><dl><div><dt>Products</dt><dd>{money(quote.subtotalCents, quote.currency)}</dd></div><div><dt>Shipping</dt><dd>{money(quote.shippingCents, quote.currency)}</dd></div><div><dt>Tax</dt><dd>{money(quote.taxCents, quote.currency)}</dd></div><div className="ks-total"><dt>Total</dt><dd>{money(quote.totalCents, quote.currency)}</dd></div></dl>{hasPhysicalProofs ? <PrintLayoutReview quote={quote} reviewed={proofReviewed} onReview={checked => setReviewedQuote(checked ? quote : null)} /> : null}{quote.issues?.length ? <ul className="ks-quote-issues">{quote.issues.map((issue, i) => <li key={i}>{issueText(issue)}</li>)}</ul> : null}{quote.expiresAt ? <p className="ks-checkout-note">Quote valid until {new Date(quote.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p> : null}<button className="ks-gold-button" disabled={busy || !quote.checkoutReady || !data?.readiness?.checkout || (hasPhysicalProofs && !proofReviewed) || Date.parse(quote.expiresAt) <= Date.now()} onClick={checkout}><LockKeyhole size={17} />{busy ? "Opening secure checkout…" : "Continue to secure checkout"}</button></div> : null}
        {!data?.readiness?.checkout ? <p className="ks-alert">{data?.readiness?.message || "Checkout is not enabled yet. You can explore and personalize without making a payment."}</p> : null}
        <p className="ks-checkout-note">Payments are processed securely by Stripe. We never store your card details. Order updates do not subscribe you to marketing.</p>
      </>}
    </section></div> : null}
  </main>;
}

function KeepsakesOrder({ token }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); request(`/orders/${encodeURIComponent(token)}`, undefined, abort.signal).then(setData).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => abort.abort();
  }, [token]);
  async function refresh() { setBusy(true); setError(""); try { setData(await request(`/orders/${encodeURIComponent(token)}`)); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  const order = data?.order || data;
  return <main className="ks-store ks-order-page"><header className="ks-header"><span className="ks-brand">THE LOLA BOOTH</span><div className="ks-brand-title"><h1><em>The Lola</em> Keepsakes</h1><p>YOUR ORDER, BEAUTIFULLY TAKEN CARE OF</p></div></header><section className="ks-order-card"><p className="ks-eyebrow">YOUR KEEPSAKE JOURNEY</p><h2>{order ? "Your order" : "Opening your order…"}</h2>{error ? <p className="ks-alert ks-error" role="alert">{error}</p> : null}{order ? <><p className="ks-order-reference">Order {order.reference || order.number || order.id}</p><p className="ks-status"><Package size={18} />{labelStatus(order.status)}</p><p>Your payment and delivery status will update here as each item progresses.</p><button className="ks-outline-button" disabled={busy} onClick={refresh}>{busy ? "Refreshing…" : "Refresh order status"}</button><div className="ks-order-items">{(data.items || order.items || []).map((item) => <article key={item.id}><h3>{item.title || item.productTitle || "Personalized keepsake"}</h3><p>Quantity {item.quantity} · <span className="ks-status">{labelStatus(item.status || item.fulfillmentStatus)}</span></p>{item.error || item.failureReason ? <p className="ks-alert">{item.failureReason || item.error}</p> : null}{item.trackingUrl && /^https:\/\//.test(item.trackingUrl) ? <a className="ks-outline-button" href={item.trackingUrl} target="_blank" rel="noopener noreferrer">Track shipment <ArrowRight size={15} /></a> : null}{item.estimatedDelivery ? <p>Estimated delivery: {item.estimatedDelivery}</p> : null}</article>)}</div>{(data.downloads || order.downloads || []).length ? <section><h3>Your digital photographs</h3><p>These download links expire. Keep your order link private.</p>{(data.downloads || order.downloads).map((download, i) => <a className="ks-outline-button" key={download.id || i} href={mediaUrl(download.url)}><Download size={17} />{download.filename || download.label || `Download photo ${i + 1}`}</a>)}</section> : null}</> : null}<p className="ks-checkout-note">Need help with your order? <a href="mailto:info@thelolabooth.com">Contact The Lola Booth</a>.</p></section></main>;
}

export default function Keepsakes() {
  const { type, token, orderToken } = useParams();
  return orderToken ? <KeepsakesOrder key={orderToken} token={orderToken} /> : <KeepsakesStore key={`${type}:${token}`} type={type} token={token} />;
}
