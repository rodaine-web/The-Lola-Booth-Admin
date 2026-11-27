import { useEffect, useRef, useState } from "react";
import { Link, useParams, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Download, Image, LockKeyhole, Minus, Package, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import "../styles/keepsakes.css";
import ProductPreview, {canPreviewKeepsake} from "../components/KeepsakesProductPreview.jsx";
import {keepsakesCartKey,restoreKeepsakesCart,saveKeepsakesCart} from "../utils/keepsakes-cart.js";
import KeepsakesPostcardPreview from "../components/KeepsakesPostcardPreview.jsx";
import {POSTCARD_EDITOR_FONTS,POSTCARD_FONTS,POSTCARD_COLORS,DEFAULT_MESSAGE_FONT,DEFAULT_MESSAGE_COLOR} from "../../shared/postcard-message-styles.js";

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
    {label}<input id={`${prefix}-${key}`} name={`${prefix}-${key}`} value={value[key] || ""} onChange={(e) => onChange({ ...value, [key]: key === "state" || key === "country" ? e.target.value.toUpperCase() : e.target.value })}
      autoComplete={recipient ? "off" : ({ name: "shipping name", address1: "shipping address-line1", address2: "shipping address-line2", city: "shipping address-level2", state: "shipping address-level1", zip: "shipping postal-code", country: "shipping country" })[key]}
      maxLength={key === "country" ? 2 : 200} required={key !== "address2"} {...extra} />
  </label>;
  return <div className="ks-address-fields">
    {field("name", "Full name")}{field("address1", "Street address")}{field("address2", "Apartment / suite (optional)")}
    {field("city", "City")}{field("state", "State / province", {pattern:"[A-Z]{2}",maxLength:2,title:"Two-letter state, such as MN"})}{field("zip", "ZIP / postal code", {pattern:"[0-9]{5}(-[0-9]{4})?",inputMode:"numeric",title:"Five-digit ZIP code, including any leading zero"})}{field("country", "Country code", { readOnly:true, pattern: "US", title: "US mailing addresses are currently supported" })}
  </div>;
}

function PostcardContent({ recipient }) {
  return <div className="ks-postcard-content" aria-label="Message and address preview">
    <small>MESSAGE & ADDRESS PREVIEW</small>
    <div><p style={{fontFamily:POSTCARD_FONTS.find(f=>f.id===(recipient.messageFont||DEFAULT_MESSAGE_FONT))?.family,color:recipient.messageColor||DEFAULT_MESSAGE_COLOR}}>{recipient.message || "Your personal message will appear here."}</p><address>{recipient.name || "Recipient name"}<br />{recipient.address1 || "Street address"}{recipient.address2 ? <><br />{recipient.address2}</> : null}<br />{[recipient.city, recipient.state, recipient.zip].filter(Boolean).join(", ") || "City, state and postal code"}<br />{recipient.country}</address></div>
  </div>;
}

function NoteFields({recipient,index,onChange}){
 return <div className="ks-note-fields"><label htmlFor={`ks-note-${index}`}>Your message (optional)<textarea id={`ks-note-${index}`} maxLength={600} value={recipient.message||''} onChange={e=>onChange({...recipient,message:e.target.value})}/></label><div className="ks-message-options"><label>Message font<select aria-label="Message font" value={recipient.messageFont||DEFAULT_MESSAGE_FONT} onChange={e=>onChange({...recipient,messageFont:e.target.value})}>{POSTCARD_EDITOR_FONTS.map(font=><option key={font.id} value={font.id}>{font.label}</option>)}</select></label><label>Font color<select aria-label="Font color" value={recipient.messageColor||DEFAULT_MESSAGE_COLOR} onChange={e=>onChange({...recipient,messageColor:e.target.value})}>{POSTCARD_COLORS.map(color=><option key={color.value} value={color.value}>{color.label}</option>)}</select></label></div><p className="ks-font-sample" style={{fontFamily:POSTCARD_FONTS.find(f=>f.id===(recipient.messageFont||DEFAULT_MESSAGE_FONT))?.family,color:recipient.messageColor||DEFAULT_MESSAGE_COLOR}}>A little memory, just for you.</p></div>;
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
  const location=useLocation(),navigate=useNavigate();
  const requestedProduct=new URLSearchParams(location.search).get("product");
  const storageKey=keepsakesCartKey(type,token);
  const [saved]=useState(()=>{try{return restoreKeepsakesCart(window.sessionStorage,storageKey);}catch{return {};}});
  const [cartStage,setCartStage]=useState("cart"),[postcardStep,setPostcardStep]=useState(0),[postcardSide,setPostcardSide]=useState("front");
  const access = `/access/${encodeURIComponent(type)}/${encodeURIComponent(token)}`;
  const [data, setData] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [productId, setProductId] = useState(""), [variantId, setVariantId] = useState(""), [assetIds, setAssetIds] = useState([]), [quantity, setQuantity] = useState(1), [crop, setCrop] = useState(INITIAL_CROP);
  const [cart, setCart] = useState(saved.cart||[]), [cartOpen, setCartOpen] = useState(false), [editing, setEditing] = useState(null), [recipients, setRecipients] = useState([{ ...EMPTY_ADDRESS, message: "" }]);
  const [returnAddress,setReturnAddress]=useState({...EMPTY_ADDRESS});
  const [postcardCount,setPostcardCount]=useState(1),[sameNote,setSameNote]=useState(true),[artworkColor,setArtworkColor]=useState('#111111'),[previewRecipient,setPreviewRecipient]=useState(0);
  const resizePostcards=value=>{const count=Math.max(1,Math.min(20,Math.trunc(Number(value))||1));setPostcardCount(count);setPreviewRecipient(n=>Math.min(n,count-1));setRecipients(current=>current.length>=count?current:[...current,...Array.from({length:count-current.length},()=>({...EMPTY_ADDRESS,message:''}))]);};
  const [email, setEmail] = useState(saved.email||""), [shippingAddress, setShippingAddress] = useState(saved.shippingAddress||EMPTY_ADDRESS), [quote, setQuote] = useState(null);
  const [reviewedQuote, setReviewedQuote] = useState(null);
  const [discountCode,setDiscountCode]=useState("");
  const proofReviewed = quote !== null && reviewedQuote === quote;
  const hasPhysicalProofs = Array.isArray(quote?.proofs) && quote.proofs.length > 0;
  useEffect(()=>{try{saveKeepsakesCart(window.sessionStorage,storageKey,{cart,email,shippingAddress});}catch{}},[storageKey,cart,email,shippingAddress]);
  const productDrafts=useRef(new Map());
  const panel = useRef(null), quoteForm = useRef(null), noticeRef = useRef(null);
  useEffect(() => {
    const abort = new AbortController();
    request(access, undefined, abort.signal).then((value) => {
      setData(value);
      const selection=new URLSearchParams(window.location.search);
      const first = value.products?.find((p) => p.available&&canPreviewKeepsake(p)&&p.id===selection.get('product'))||value.products?.find((p) => p.available&&canPreviewKeepsake(p));
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
  const products = (data?.products || []).filter((p) => p.available&&canPreviewKeepsake(p)), assets = data?.assets || [];
  const product = products.find((p) => p.id === productId), variant = product?.variants?.find((v) => v.id === variantId) || product?.variants?.[0];
  const detail=Boolean(requestedProduct&&requestedProduct===productId&&product);
  const bundle = /bundle/.test(category(product)), digital = isDigital(product), postcard = isPostcard(product);
  const eligible = assets.filter((asset) => digital ? asset.digitalEligible && !asset.included : asset.merchandiseEligible===true);
  const selectedAssets = eligible.filter((asset) => assetIds.includes(asset.id)), selectedAsset = selectedAssets[0];
  const digitalOnly=cart.length>0&&cart.every(item=>isDigital(products.find(p=>p.id===item.productId)||{}));
  const requiresShipping = cart.some((item) => { const p = products.find((p) => p.id === item.productId); return p && !isDigital(p) && !isPostcard(p); });
  const unavailableItems=cart.some(item=>!products.some(p=>p.id===item.productId&&p.variants?.some(v=>v.id===item.variantId))||item.assetIds.some(id=>!assets.some(a=>a.id===id)));
  const amount = cart.reduce((sum, item) => sum + Number(products.find((p) => p.id === item.productId)?.retailCents || 0) * item.quantity * (item.recipients?.length || 1), 0);
  const spec = variant?.printSpec, requiredWidth = Number(spec?.widthPx), requiredHeight = Number(spec?.heightPx);
  const inset=2*(Number(spec?.bleedPx||0)+Number(spec?.safePx||0));
  const margin=crop.fit==='cover'?0:inset;
  const ratio=selectedAsset&&Math[crop.fit==='cover'?'max':'min']((requiredWidth-margin)/selectedAsset.width,(requiredHeight-margin)/selectedAsset.height)*crop.zoom;
  const lowResolution = !digital && selectedAsset && requiredWidth && requiredHeight && ratio>1;
  const currency = product?.currency || "USD";
  function keepProductDraft(){if(productId)productDrafts.current.set(productId,{variantId,assetIds,quantity,crop,recipients,postcardCount,sameNote,artworkColor,returnAddress});}
  function chooseProduct(next,history=true) {
    keepProductDraft();const draft=productDrafts.current.get(next.id);
    if(history)navigate({pathname:location.pathname,search:new URLSearchParams({product:next.id,...(assetIds[0]?{asset:assetIds[0]}:{})}).toString()});setPostcardStep(0);
    setProductId(next.id); setVariantId(next.variants?.[0]?.id || ""); setQuantity(1); setCrop(INITIAL_CROP); setEditing(null); setError("");
    const allowed = assets.filter((a) => isDigital(next)?a.digitalEligible&&!a.included:a.merchandiseEligible===true);
    setAssetIds(allowed.some((a) => a.id === assetIds[0]) ? [assetIds[0]] : allowed[0] ? [allowed[0].id] : []);
    if(draft){setVariantId(draft.variantId);setAssetIds(draft.assetIds);setQuantity(draft.quantity);setCrop(draft.crop);setRecipients(draft.recipients);setPostcardCount(draft.postcardCount);setSameNote(draft.sameNote);setArtworkColor(draft.artworkColor);setReturnAddress(draft.returnAddress||{...EMPTY_ADDRESS});}
  }
  useEffect(()=>{const wanted=new URLSearchParams(location.search).get('product');const next=products.find(p=>p.id===wanted);if(next&&next.id!==productId)chooseProduct(next,false);},[location.search,data]);
  function updateCart(next) { setCart(next); setQuote(null); }
  function addItem(e) {
    e.preventDefault();
    if (!product || !variant || !selectedAssets.length || !data.enabled) return;
    if(postcard){const invalid=[...e.currentTarget.querySelectorAll('.ks-recipient input')].find(input=>!input.checkValidity());if(invalid){setPostcardStep(1);requestAnimationFrame(()=>invalid.reportValidity());return;}}
    const item = { productId: product.id, variantId: variant.id, assetIds: selectedAssets.map((a) => a.id), quantity: digital||postcard ? 1 : quantity, customization: { ...crop }, ...(postcard ? { returnAddress:{...returnAddress},postcardArtworkColor:artworkColor,recipients: recipients.slice(0,postcardCount).map((r) => ({ ...r,...(sameNote?{message:recipients[0].message||'',messageFont:recipients[0].messageFont||'classic',messageColor:recipients[0].messageColor||'#26221d'}:{}) })) } : {}) };
    if (editing !== null) { updateCart(cart.map((row, index) => index === editing ? item : row)); setNotice("Your keepsake has been updated."); }
    else { updateCart([...cart, item]); setNotice(`${product.title} added to your cart.`); }
    setEditing(null); requestAnimationFrame(() => noticeRef.current?.focus());
  }
  function editItem(index) {
    setQuote(null); setReviewedQuote(null);
    const item = cart[index]; setReturnAddress(item.returnAddress||{...EMPTY_ADDRESS}); setProductId(item.productId); setVariantId(item.variantId); setAssetIds(item.assetIds); setQuantity(item.quantity); setCrop(item.customization); setRecipients(item.recipients?.length?item.recipients:[{ ...EMPTY_ADDRESS, message: '' }]);setPostcardCount(item.recipients?.length||1);setSameNote(false);setArtworkColor(item.postcardArtworkColor||'#111111');setPreviewRecipient(0); setEditing(index);setPostcardStep(0);navigate({pathname:location.pathname,search:new URLSearchParams({product:item.productId}).toString()}); setCartOpen(false); setNotice("Editing your keepsake. Save your changes below."); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function getQuote(e) {
    e.preventDefault(); setBusy(true); setError(""); setQuote(null);
    try { setQuote(await request(`${access}/quote`, { items: cart, email,discountCode,...(!digitalOnly?{shippingAddress}:{}) })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function checkout() {
    if (!quote?.checkoutReady || !data.readiness?.checkout || (hasPhysicalProofs && !proofReviewed)) return;
    setBusy(true); setError("");
    try {
      const next = await request(`${access}/checkout`, { quoteId: quote.quoteId, proofReviewed });
      const destination = new URL(next.url);
      if (destination.protocol !== "https:" || !["checkout.stripe.com", "buy.stripe.com"].includes(destination.hostname)) throw Error("The secure checkout link is unavailable. Please try again.");
      try{window.sessionStorage.setItem(`lola-keepsakes:checkout:${quote.quoteId}`,storageKey);}catch{}
      window.location.assign(destination.href);
    } catch (e) { setError(e.message); setBusy(false); }
  }
  function updateContact(fn) { fn(); setQuote(null); }
  const collection=()=>{keepProductDraft();navigate({pathname:location.pathname,search:assetIds[0]?new URLSearchParams({asset:assetIds[0]}).toString():''});setError('');};
  const previewAsset=next=>{const candidates=assets.filter(a=>isDigital(next)?a.digitalEligible&&!a.included:a.merchandiseEligible);return candidates.find(a=>a.id===assetIds[0])||candidates[0];};
  const describe=next=>isDigital(next)?/bundle/.test(category(next))?'Your selected eligible originals, together.':'An eligible original, delivered digitally.':isPostcard(next)?'Your photo and a personal note, mailed to a loved one.':category(next)==='mug'?'A little reminder of your favorite moment.':category(next)==='frame'?'Your favorite moment, beautifully framed.':'Your photo, professionally printed.';
  const collectionCards=<section className="ks-collection" aria-label="Personalized product collection"><div className="ks-section-title"><p className="ks-eyebrow">THE LOLA KEEPSAKES</p><h2>Shop personalized keepsakes</h2><p>Made with your photo. Choose a keepsake to make it yours.</p></div><div className="ks-product-grid">{products.map(next=><article className="ks-product-card" key={next.id}><ProductPreview product={next} asset={previewAsset(next)} variant={next.variants?.[0]} compact/><div><h3>{next.title}</h3><p>{describe(next)}</p><strong>{money(next.retailCents,next.currency)}</strong><button className="ks-gold-button" type="button" onClick={()=>chooseProduct(next)} aria-label={`View options for ${next.title}`}>View options</button></div></article>)}</div></section>;
  const galleryPath = `/gallery/${encodeURIComponent(type)}/${encodeURIComponent(token)}`;
  return <main className="ks-store ks-redesign">
    <header className="ks-header"><Link className="ks-brand" to={galleryPath}>THE LOLA BOOTH</Link><div className="ks-brand-title"><h1><em>The Lola Keepsakes</em></h1><p>PERSONALIZED MEMORIES</p></div><button className="ks-cart-button" onClick={() => {setCartStage("cart");setCartOpen(true);}}><ShoppingCart size={24} /> Cart ({cart.reduce((n, item) => n + item.quantity*(item.recipients?.length||1), 0)})</button></header>
    <div className="ks-subnav"><Link to={galleryPath}><ArrowLeft size={15} /> Back to your photos</Link><span>{data?.album?.title || "Your private photo experience"}</span><span><LockKeyhole size={13} /> Secure guest checkout</span></div>
    {error && !cartOpen ? <p className="ks-alert ks-error" role="alert">{error}</p> : null}
    {data?.readiness?.mode==='SANDBOX'&&<p className="ks-alert" role="status">Demo pricing · sandbox checkout only. No live payments or physical mail.</p>}
    {notice ? <p ref={noticeRef} tabIndex={-1} className="ks-alert ks-success" role="status"><Check size={16} />{notice}<button onClick={() => setCartOpen(true)}>View cart <ArrowRight size={15} /></button></p> : null}
    {!data ? <section className="ks-empty"><Package size={32} /><h2>{error ? "Your keepsakes are unavailable" : "Opening your keepsakes…"}</h2><p>{error ? "You can still return to your gallery to view and download the photos included with your event." : "Finding the products and photos available for your event."}</p></section> : !data.enabled || !products.length ? <section className="ks-empty"><Image size={36} /><p className="ks-eyebrow">YOUR MOMENT, BEAUTIFULLY KEPT</p><h2>{data.enabled ? "Keepsakes are being prepared" : "Enjoy your photos"}</h2><p>{data.enabled ? "There are no verified products available for this event yet. Please check back or contact your host." : "Shopping is not enabled for this event. Your existing gallery and included downloads are still available."}</p><Link className="ks-gold-button" to={galleryPath}>Return to your gallery <ArrowRight size={18} /></Link></section> : <>
      {!detail?<><section className="ks-collection-hero"><img crossOrigin="anonymous" src={mediaUrl((assets.find(a=>a.id===assetIds[0])||assets[0])?.url)} alt="Your selected event photo"/><div><p className="ks-eyebrow">YOUR EVENT PHOTO</p><h2>Turn your memory into a wonderful keepsake.</h2><p>Personalized photo gifts, prints and more — all featuring your favorite moment.</p><Link className="ks-outline-button" to={galleryPath}>View, download or share your photo</Link></div></section>{collectionCards}</>:<><button type="button" className="ks-back" onClick={collection}><ArrowLeft size={17}/> Back to Keepsakes</button>
      <section className="ks-shop-grid" aria-label="Personalize your keepsake">
        <div className="ks-preview-panel">{postcard&&<div className="ks-side-tabs" role="group" aria-label="Postcard view"><button type="button" aria-pressed={postcardSide==='front'} onClick={()=>setPostcardSide('front')}>Front</button><button type="button" aria-pressed={postcardSide==='back'} onClick={()=>setPostcardSide('back')}>Back</button></div>}{postcard&&postcardSide==='back'&&variant?.backTemplate==='lola-connect-v2'?<KeepsakesPostcardPreview access={access} productId={product.id} variantId={variant.id} artworkColor={artworkColor} index={previewRecipient} recipient={{...recipients[previewRecipient],...(sameNote?{message:recipients[0].message,messageFont:recipients[0].messageFont,messageColor:recipients[0].messageColor}:{})}}/>:<ProductPreview product={product} asset={selectedAsset} variant={variant} crop={crop} />}{selectedAsset ? <div className="ks-preview-meta"><span>{selectedAsset.label}</span><span>{selectedAsset.width && selectedAsset.height ? `${selectedAsset.width.toLocaleString()} × ${selectedAsset.height.toLocaleString()} px` : "Resolution checked before checkout"}</span></div> : null}</div>
        <form className="ks-customizer" noValidate={postcard} onSubmit={addItem}><p className="ks-script">Make it yours</p><h2>{product?.title}</h2><p className="ks-product-description">{digital ? bundle ? "Keep the original files you select, together in one digital bundle." : "Your available original photograph, ready to download after payment." : postcard ? "A personal hello, printed and mailed to someone special." : "A favorite moment, made into something you can hold."}</p>
          <fieldset><legend>{bundle ? "Choose your photos" : "Choose your photo"}</legend><div className="ks-photo-swatches">{eligible.map((asset) => <button type="button" key={asset.id} aria-label={`Select ${asset.label}`} aria-pressed={assetIds.includes(asset.id)} onClick={() => setAssetIds((current) => bundle ? current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id] : [asset.id])}><img crossOrigin="anonymous" src={mediaUrl(asset.url)} alt="" loading="lazy" /><span>{asset.label}</span></button>)}</div></fieldset>
          {product?.variants?.length ? <fieldset><legend>Choose an option</legend><div className="ks-variants">{product.variants.filter(v=>canPreviewKeepsake(product,v)).map((v) => <button type="button" key={v.id} aria-pressed={variant?.id === v.id} onClick={() => setVariantId(v.id)}>{(v.color||v.attributes?.color) ? <i style={{ background: v.color||v.attributes?.color }} aria-hidden="true" /> : null}{v.label}</button>)}</div></fieldset> : null}
          {!digital && variant?.printSpec ? <details className="ks-adjustments"><summary>Adjust your photo</summary><label htmlFor="ks-fit">Photo layout<select id="ks-fit" aria-label="Photo layout" value={crop.fit} onChange={(e) => setCrop({ ...crop, fit: e.target.value,zoom:1 })}><option value="contain">Keep the complete photo</option><option value="cover">Fill the print area (crops edges)</option></select></label><label htmlFor="ks-zoom">Zoom <output>{crop.zoom.toFixed(2)}×</output><input id="ks-zoom" disabled={crop.fit!=="cover"} type="range" min="1" max="3" step="0.05" value={crop.zoom} onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })} /></label><label htmlFor="ks-x">Horizontal position<input id="ks-x" type="range" min="0" max="1" step="0.01" value={crop.x} onChange={(e) => setCrop({ ...crop, x: Number(e.target.value) })} /></label><label htmlFor="ks-y">Vertical position<input id="ks-y" type="range" min="0" max="1" step="0.01" value={crop.y} onChange={(e) => setCrop({ ...crop, y: Number(e.target.value) })} /></label><button type="button" className="ks-text-button" onClick={() => setCrop(INITIAL_CROP)}>Reset adjustments</button></details> : null}
          {lowResolution ? <p className="ks-alert" role="status">This photo may be too small at the current zoom. Final artwork resolution is checked before payment.</p> : null}
          {postcard ? <div className="ks-recipients">
            <h3>Send a postcard to a loved one</h3><nav className="ks-stepper" aria-label="Postcard steps">{["Customize","Recipients","Review"].map((name,i)=><button key={name} type="button" aria-current={postcardStep===i?"step":undefined} onClick={()=>setPostcardStep(i)}><span>{i+1}</span>{name}</button>)}</nav><div hidden={postcardStep!==0}>
            <label htmlFor="ks-postcard-count">How many postcards?<input id="ks-postcard-count" type="number" min="1" max="20" value={postcardCount} onChange={e=>resizePostcards(e.target.value)}/></label>
            <p>{postcardCount} postcard{postcardCount===1?'':'s'} · one card per recipient</p>
            {variant?.backTemplate==='lola-connect-v2'&&<><label htmlFor="ks-artwork-color">Back artwork color<input id="ks-artwork-color" type="color" value={artworkColor} onInput={e=>setArtworkColor(e.target.value)} onChange={e=>setArtworkColor(e.target.value)}/></label><div className="ks-color-palette">{["#111111","#b18a43","#ba8790","#6b8069","#628b9b","#703040"].map(color=><button key={color} type="button" aria-label={`Artwork color ${color}`} aria-pressed={artworkColor===color} style={{background:color}} onClick={()=>setArtworkColor(color)}>{artworkColor===color?<Check size={16}/>:null}</button>)}</div><p>One approved back design. Change the artwork color; the background stays white.</p></>}
            <label className="ks-same-note"><input type="checkbox" checked={sameNote} onChange={e=>setSameNote(e.target.checked)}/>Use the same note for every recipient</label>
            <NoteFields recipient={recipients[0]} index={0} onChange={next=>setRecipients(current=>current.map((r,i)=>i===0?next:r))}/>
            <button type="button" className="ks-outline-button" onClick={()=>setPostcardStep(1)}>Continue to recipients</button></div>
            <div hidden={postcardStep!==1}><fieldset className="ks-recipient"><legend>Your return address</legend><p>Enter the sender name and address for all postcards in this set.</p><AddressFields prefix="ks-return-address" value={returnAddress} onChange={setReturnAddress}/></fieldset><p>Enter one name and mailing address for each postcard.</p>{recipients.slice(0,postcardCount).map((recipient,index)=><fieldset className="ks-recipient" key={index}><legend>Recipient {index+1}</legend>
              <AddressFields prefix={`ks-recipient-${index}`} value={recipient} recipient onChange={next=>setRecipients(current=>current.map((r,i)=>i===index?next:r))}/>
              {!sameNote&&<NoteFields recipient={recipient} index={index+1} onChange={next=>setRecipients(current=>current.map((r,i)=>i===index?next:r))}/>}
              <button type="button" className="ks-text-button" onClick={()=>{setPreviewRecipient(index);setPostcardSide('back');}}>Preview recipient {index+1}</button>
            </fieldset>)}<button type="button" className="ks-outline-button" disabled={postcardCount>=20} onClick={()=>resizePostcards(postcardCount+1)}><Plus size={15}/>Add another recipient</button><button type="button" className="ks-gold-button" onClick={e=>{const inputs=[...e.currentTarget.closest('form').querySelectorAll('.ks-recipient input')];if(inputs.every(input=>input.reportValidity()))setPostcardStep(2);}}>Review postcards</button></div>
            <div hidden={postcardStep!==2} className="ks-recipient-review"><section><strong>Return address: {returnAddress.name}</strong><p>{returnAddress.address1} {returnAddress.address2}<br/>{returnAddress.city}, {returnAddress.state} {returnAddress.zip}</p></section><h4>Review your {postcardCount} postcard{postcardCount===1?'':'s'}</h4>{recipients.slice(0,postcardCount).map((r,i)=><article key={i}><strong>Recipient {i+1}: {r.name||'Name required'}</strong><p>{r.address1} {r.address2}<br/>{r.city}, {r.state} {r.zip}</p><p className="ks-review-note">{sameNote?recipients[0].message:r.message}</p><button type="button" onClick={()=>{setPostcardStep(1);setPreviewRecipient(i);}}>Edit recipient {i+1}</button></article>)}</div>
          </div>:null}
          <div className="ks-buy-row"><div><label>Quantity</label><Quantity value={postcard?postcardCount:digital?1:quantity} disabled={digital} onChange={postcard?resizePostcards:setQuantity} /></div><div className="ks-price"><span>{postcard && postcardCount > 1 ? `${postcardCount} recipients · each` : "Product price"}</span><strong>{money(product?.retailCents, currency)}</strong></div></div>
          <button className="ks-gold-button ks-add" type="submit" disabled={!selectedAssets.length || !variant || !data.enabled || lowResolution || (postcard&&postcardStep!==2)}><ShoppingCart size={22} />{editing === null ? "Add to cart" : "Save changes"}</button><p className="ks-checkout-note">{digital ? "Secure download access follows verified payment." : "Shipping and applicable taxes are confirmed before payment."}</p>
          {editing !== null ? <button type="button" className="ks-text-button" onClick={() => { setEditing(null); setNotice(""); }}>Cancel editing</button> : null}
        </form>
      </section>
      <section className="ks-detail-more"><h2>More keepsake ideas</h2>{collectionCards}</section></>}
    </>}
    <footer className="ks-footer"><span>THE LOLA BOOTH</span><p>Photo experiences for meaningful moments.</p><a href="mailto:info@thelolabooth.com">Need a hand?</a></footer>
    {cartOpen ? <div className="ks-cart-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) setCartOpen(false); }}><section className="ks-cart-panel" ref={panel} role="dialog" aria-modal="true" aria-label="Your keepsakes cart" tabIndex={-1}><header><div><p className="ks-eyebrow">YOUR MOMENTS, READY TO KEEP</p><h2>{cartStage==="cart"?"Your cart":"Checkout"}</h2></div><button aria-label="Close cart" disabled={busy} onClick={() => setCartOpen(false)}><X /></button></header>
      {error ? <p className="ks-alert ks-error" role="alert">{error}</p> : null}
      {!cart.length ? <div className="ks-empty"><ShoppingCart size={35} /><h3>Your cart is waiting for a moment.</h3><p>Choose a photo and a keepsake to start.</p><button className="ks-gold-button" onClick={() => setCartOpen(false)}>Keep exploring <ArrowRight size={18} /></button></div> : <>
        <ul className="ks-cart-items">{cart.map((item, index) => { const p = products.find((p) => p.id === item.productId), a = assets.find((a) => a.id === item.assetIds[0]), v = p?.variants?.find((v) => v.id === item.variantId); return <li key={index}><ProductPreview product={p} asset={a} variant={v} crop={item.customization} compact /><div><h3>{p?.title || "Keepsake"}</h3><p>{v?.label} · {item.assetIds.length > 1 ? `${item.assetIds.length} photos` : a?.label}</p><p>Quantity {item.recipients?.length||item.quantity}{item.recipients?.length ? ` · ${item.recipients.length} recipient${item.recipients.length > 1 ? "s" : ""}` : ""}</p>{item.recipients?.length>0&&<details className="ks-cart-recipient-details"><summary>Review {item.recipients.length} recipients and notes</summary>{item.recipients.map((r,n)=><div key={n}><strong>{r.name}</strong><p>{r.address1} {r.address2}, {r.city}, {r.state} {r.zip}</p><p>{r.message}</p></div>)}</details>}<strong>{p&&v?money(Number(p.retailCents) * item.quantity * (item.recipients?.length || 1), p.currency):'Unavailable — remove this item'}</strong><div className="ks-cart-item-actions"><button disabled={busy} onClick={() => editItem(index)}>Edit item {index + 1}</button><button aria-label={`Remove item ${index + 1}`} disabled={busy} onClick={() => updateCart(cart.filter((_, i) => i !== index))}><Trash2 size={14} />Remove</button></div></div></li>; })}</ul>
        {unavailableItems&&<p role="alert" className="ks-alert">A product, option or photo is no longer available. Please remove it or choose an available option.</p>}<div className="ks-cart-subtotal"><span>Product subtotal</span><strong>{unavailableItems?"Needs review":money(amount, products.find((p) => p.id === cart[0]?.productId)?.currency)}</strong></div>
        {cartStage==="cart"?<button type="button" className="ks-gold-button ks-proceed" disabled={unavailableItems} onClick={()=>setCartStage('checkout')}>Proceed to checkout</button>:<><button type="button" className="ks-text-button" onClick={()=>setCartStage('cart')}>Back to cart</button>
        <form ref={quoteForm} onSubmit={getQuote} className="ks-checkout-form"><h3>{digitalOnly?"Email delivery":"Delivery details"}</h3><label htmlFor="ks-email">Email for your order updates<input id="ks-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => updateContact(() => setEmail(e.target.value))} /></label>{!digitalOnly&&<><h4>{requiresShipping ? "Shipping address" : "Billing address for tax"}</h4><AddressFields prefix="ks-shipping" value={shippingAddress} onChange={(next) => updateContact(() => setShippingAddress(next))} />{!requiresShipping && <p>This address determines applicable tax. Postcards use the recipients saved on each item; digital purchases need no shipment.</p>}</>}{digitalOnly&&<p>Your edited images will be emailed as secure JPEG download links. Any applicable tax is calculated at secure checkout.</p>}<label>Discount code (optional)<input aria-label="Discount code" maxLength={40} value={discountCode} onChange={e=>updateContact(()=>setDiscountCode(e.target.value.toUpperCase()))}/></label><button type="submit" className="ks-outline-button" disabled={busy}>{busy ? "Checking your order…" : digitalOnly?"Review digital order":"Calculate shipping & tax"}</button></form>
        {quote ? <div className="ks-quote" aria-live="polite"><h3>Your order total</h3><dl><div><dt>Products</dt><dd>{money(quote.subtotalCents, quote.currency)}</dd></div>{quote.discountCents>0&&<div><dt>Discount · {quote.discountCode}</dt><dd>−{money(quote.discountCents,quote.currency)}</dd></div>}<div><dt>Shipping</dt><dd>{money(quote.shippingCents, quote.currency)}</dd></div><div><dt>Tax</dt><dd>{quote.taxAtCheckout?"Calculated at payment":money(quote.taxCents, quote.currency)}</dd></div><div className="ks-total"><dt>{quote.taxAtCheckout?"Subtotal before tax":"Total"}</dt><dd>{money(quote.totalCents, quote.currency)}</dd></div></dl>{hasPhysicalProofs ? <PrintLayoutReview quote={quote} reviewed={proofReviewed} onReview={checked => setReviewedQuote(checked ? quote : null)} /> : null}{quote.issues?.length ? <ul className="ks-quote-issues">{quote.issues.map((issue, i) => <li key={i}>{issueText(issue)}</li>)}</ul> : null}{quote.expiresAt ? <p className="ks-checkout-note">Quote valid until {new Date(quote.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p> : null}<button className="ks-gold-button" disabled={busy || !quote.checkoutReady || !data?.readiness?.checkout || (hasPhysicalProofs && !proofReviewed) || Date.parse(quote.expiresAt) <= Date.now()} onClick={checkout}><LockKeyhole size={17} />{busy ? "Opening secure checkout…" : "Continue to secure checkout"}</button></div> : null}
        </>}{!data?.readiness?.checkout ? <p className="ks-alert">{data?.readiness?.message || "Checkout is not enabled yet. You can explore and personalize without making a payment."}</p> : null}
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
  useEffect(()=>{if(!order?.paidAt||!order?.quoteId)return;try{const pending=`lola-keepsakes:checkout:${order.quoteId}`,key=window.sessionStorage.getItem(pending);if(key?.startsWith('lola-keepsakes:v2:'))window.sessionStorage.removeItem(key);window.sessionStorage.removeItem(pending);}catch{}},[order?.paidAt,order?.quoteId]);
  const items=data?.items||order?.items||[],jobs=data?.fulfillments||[],physicalJobs=jobs.filter(j=>j.provider!=='DIGITAL');
  const paid=Boolean(order?.paidAt)||['PAID','FULFILLING','SHIPPED','COMPLETE','REQUIRES_REVIEW','REFUND_PENDING','REFUNDED'].includes(order?.status);
  const physical=items.some(item=>item.provider&&item.provider!=='DIGITAL');
  const submitted=physicalJobs.length>0&&physicalJobs.every(j=>['SUBMITTED','SHIPPED','COMPLETE'].includes(j.status));
  const shipped=physicalJobs.length>0&&physicalJobs.every(j=>['SHIPPED','COMPLETE'].includes(j.status));
  const delivered=physicalJobs.length>0&&physicalJobs.every(j=>j.status==='COMPLETE');
  const stopped=['CANCELLED','REFUNDED','REFUND_PENDING','PAYMENT_FAILED','EXPIRED'].includes(order?.status);
  const steps=[['Payment received',paid],['Preparing your order',paid&&!stopped],['Submitted for production',submitted],['Shipped / mailed',shipped],['Delivered',delivered]];
  return <main className="ks-store ks-order-page"><header className="ks-header"><span className="ks-brand">THE LOLA BOOTH</span><div className="ks-brand-title"><h1><em>The Lola Keepsakes</em></h1><p>YOUR MOMENT, BEAUTIFULLY KEPT</p></div></header><section className="ks-order-card">
   {error&&<p role="alert" className="ks-alert ks-error">{error}</p>}
   {order?<><div className="ks-order-hero"><div><p className="ks-eyebrow">YOUR KEEPSAKES ORDER</p><h2>{stopped?'Your order update':paid?'Thank you!':'Your order'}</h2><p>{paid&&!stopped?'Your payment was received. Follow each item’s progress below.':'Your current payment and fulfillment details appear below.'}</p></div><button className="ks-outline-button" disabled={busy} onClick={refresh}>{busy?'Refreshing…':'Refresh order status'}</button></div>
   {order.mode==='TEST'&&<p className="ks-alert">Sandbox test order · no live payment or physical shipment.</p>}
   <button type="button" className="ks-outline-button ks-print-receipt" onClick={()=>window.print()}>Print receipt</button><div className="ks-order-facts"><div>Order number<strong className="ks-order-reference">{order.id}</strong></div>{order.createdAt&&<div>Order date<strong>{new Date(order.createdAt).toLocaleDateString()}</strong></div>}{Number.isInteger(order.totalCents)&&<div>Order total<strong>{money(order.totalCents,order.currency)}</strong></div>}<div>Current status<strong>{labelStatus(order.status)}</strong></div></div>
   {physical&&paid&&!stopped&&<><p className="ks-alert">Payment confirms your order. Physical items are marked shipped or delivered only when confirmed by the fulfillment partner.</p><ol id="tracking" className="ks-timeline" aria-label="Order progress">{steps.map(([name,complete],i)=><li key={name} className={complete?'complete':''}><span>{complete?<Check size={18}/>:i+1}</span>{name}</li>)}</ol></>}
   {order.status==='REQUIRES_REVIEW'&&<p role="status" className="ks-alert">An item needs attention. Our team will review the issue; your other items may continue separately.</p>}
   {Number.isInteger(order.subtotalCents)&&<dl className="ks-receipt-totals"><div><dt>Products</dt><dd>{money(order.subtotalCents,order.currency)}</dd></div>{order.discountCents>0&&<div><dt>Discount · {order.discountCode}</dt><dd>−{money(order.discountCents,order.currency)}</dd></div>}<div><dt>Shipping</dt><dd>{money(order.shippingCents,order.currency)}</dd></div><div><dt>Tax</dt><dd>{money(order.taxCents,order.currency)}</dd></div>{order.refundedCents>0&&<div><dt>Refunded</dt><dd>{money(order.refundedCents,order.currency)}</dd></div>}</dl>}
   <h3>Your keepsakes</h3><div className="ks-order-items">{items.map(item=><article key={item.id}>{item.previewUrl&&<ProductPreview product={item} asset={{url:item.previewUrl,label:item.photos?.[0]||'Your photo'}} variant={item.variant} crop={item.customization} compact/>}<h3>{item.title}</h3>{item.variant?.label&&<p>{item.variant.label}</p>}<p>Quantity {item.quantity}{item.cancelledQuantity?` · Cancelled ${item.cancelledQuantity} · Remaining ${item.remainingQuantity}`:''} · <strong>{labelStatus(item.status)}</strong></p>{Number.isInteger(item.amountCents)&&<p>{money(item.amountCents,order.currency)}</p>}{item.failureReason&&<p className="ks-alert">This item needs a team review. Please contact us for an update.</p>}{item.recipients?.length>0&&<details className="ks-cart-recipient-details"><summary>Postcard recipients ({item.recipients.length})</summary>{item.recipients.map((r,n)=><div key={n}><strong>{r.name}</strong><p>{r.address1} {r.address2}<br/>{r.city}, {r.state} {r.zip}</p><p>{labelStatus(r.status)}</p><p>{r.message}</p></div>)}</details>}{item.trackingUrl&&/^https:\/\//.test(item.trackingUrl)&&<a className="ks-outline-button" href={item.trackingUrl} target="_blank" rel="noopener noreferrer">Track shipment</a>}{item.estimatedDelivery&&<p>Estimated delivery: {item.estimatedDelivery}</p>}</article>)}</div>
   {(data.downloads||order.downloads||[]).length>0&&<section id="digital" className="ks-downloads"><h3>Your digital photographs</h3><p>Your purchased files are ready. Keep your order link private and save your photographs before the download links expire.</p>{(data.downloads||order.downloads).map((download,i)=><a className="ks-outline-button" key={download.id||i} href={mediaUrl(download.url)}><Download size={17}/>{download.filename||`Download photo ${i+1}`}</a>)}</section>}
   </>:<p>Opening your order…</p>}
   <p className="ks-checkout-note">Need help with your order? <a href="mailto:info@thelolabooth.com">Contact The Lola Booth</a>.</p></section></main>;
}

export default function Keepsakes() {
  const { type, token, orderToken } = useParams();
  return orderToken ? <KeepsakesOrder key={orderToken} token={orderToken} /> : <KeepsakesStore key={`${type}:${token}`} type={type} token={token} />;
}
