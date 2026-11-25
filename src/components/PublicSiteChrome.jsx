import {useEffect,useId,useState} from 'react';
import {useLocation} from 'react-router-dom';
import {lolaOrigins} from '../../shared/keepsakes-host.js';
import '../styles/public-site-chrome.css';
export const publicOrigins=lolaOrigins(import.meta.env.VITE_APP_ENV);
const website=path=>publicOrigins.website+'/'+path;
const mainLinks=[['Experiences',website('experiences.html')],['Packages',website('packages.html')],['About',website('about.html')],['FAQ',website('faq.html')],['Contact',website('contact.html')],['Gallery',publicOrigins.gallery],['Shop',publicOrigins.shop]];
const experiences=[['The Lola Glam','experiences.html#glam'],['The Lola 360','experiences.html#360'],['The Lola Magic Mirror','experiences.html#mirror'],['The Lola Vogue','experiences.html#vogue'],['Audio Guestbook','availability.html?experience=audio'],['Business/Corporates','packages.html?customerType=BUSINESS']];
export function PublicSiteHeader(){
 const [open,setOpen]=useState(false),id=useId(),location=useLocation();
 useEffect(()=>setOpen(false),[location.pathname]);
 useEffect(()=>{if(!open)return;const close=e=>{if(e.key==='Escape')setOpen(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[open]);
 return <header className="lola-public-chrome lola-site-header"><div className="lola-site-container lola-site-nav">
  <a className="lola-site-brand" href={publicOrigins.website} aria-label="The Lola Booth home"><img src="/brand/lola-web-legible.svg" alt="The Lola Booth" width="245" height="54"/></a>
  <button className="lola-site-menu" type="button" aria-label={open?'Close navigation':'Open navigation'} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}>☰</button>
  <nav className="lola-site-links" aria-label="Main navigation">{mainLinks.map(([label,href])=><a key={label} href={href}>{label}</a>)}</nav>
  <a className="lola-site-button lola-site-book" href={website('availability.html')}>Book Now <span aria-hidden="true">→</span></a>
 </div><nav id={id} className="lola-site-mobile" hidden={!open} aria-label="Mobile navigation">{mainLinks.map(([label,href])=><a key={label} href={href}>{label}</a>)}<a className="lola-site-button" href={website('availability.html')}>Book Now <span aria-hidden="true">→</span></a></nav></header>;
}
export function PublicSiteFooter({settings:provided}){
 const [loaded,setLoaded]=useState(null);
 useEffect(()=>{if(provided)return;const abort=new AbortController(),api=import.meta.env.VITE_API_URL||'/api';fetch(api+(import.meta.env.VITE_APP_ENV==='production'?'/public/site':'/public/staging/site'),{signal:abort.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw Error();return response.json();}).then(site=>setLoaded(site.settings||null)).catch(()=>{});return()=>abort.abort();},[provided]);
 const settings=provided||loaded||{},email=settings.contact_email||'info@thelolabooth.com',phone=settings.phone||'(773) 240-2744',phoneHref='tel:+'+String(phone).replace(/[^0-9]/g,'').replace(/^(?=\d{10}$)/,'1');
 return <div className="lola-public-chrome lola-site-ending"><section className="lola-site-prefooter" aria-label="Plan your event"><div className="lola-site-container"><h2>Good people. Better photos.</h2><p>Let’s create an experience your guests will talk about long after the event.</p><a className="lola-site-button" href={website('availability.html')}>Book Now <span aria-hidden="true">→</span></a></div></section>
 <footer className="lola-site-footer"><div className="lola-site-container lola-site-footer-grid"><div className="lola-site-footer-brand"><a className="lola-site-brand" href={publicOrigins.website} aria-label="The Lola Booth home"><img src="/brand/lola-web-legible.svg" alt="The Lola Booth" width="220" height="50"/></a><p>Premium photo and video experiences for celebrations, corporate events and brand activations.</p></div>
 <nav aria-label="Footer navigation"><h2>Sitemap</h2>{mainLinks.slice(0,5).map(([label,href])=><a key={label} href={href}>{label}</a>)}<a href={website('availability.html')}>Book Your Experience</a>{mainLinks.slice(5).map(([label,href])=><a key={label} href={href}>{label}</a>)}</nav>
 <nav aria-label="Explore experiences"><h2>Our Experiences</h2>{experiences.map(([label,path])=><a key={label} href={website(path)}>{label}</a>)}</nav>
 <div className="lola-site-contact"><h2>Get in Touch</h2><address><a href={'mailto:'+email}>{email}</a><a href={phoneHref}>{phone}</a><span>Service area: {settings.service_area||'Chicago & surrounding areas'}</span></address><div className="lola-site-socials">{[['Instagram','instagram','https://instagram.com/thelolabooth'],['TikTok','tiktok','https://tiktok.com/@thelolabooth']].map(([label,key,fallback])=><a key={key} href={/^https:\/\//.test(settings[key+'_url']||'')?settings[key+'_url']:fallback} aria-label={label}><svg className="lola-site-social-icon" aria-hidden="true"><use href={'/staging-site/design-icons.svg#'+key}/></svg></a>)}</div></div></div>
 <p className="lola-site-legal">{settings.copyright_text||`© ${new Date().getFullYear()} The LOLA Booth. All rights reserved.`} · <a href={website('privacy.html')}>Privacy Policy</a> · <a href={website('terms.html')}>Terms of Service</a> · <a href={website('sitemap.xml')}>XML Sitemap</a></p></footer></div>;
}
export function PublicSiteLayout({children}){return <><PublicSiteHeader/>{children}<PublicSiteFooter/></>;}
