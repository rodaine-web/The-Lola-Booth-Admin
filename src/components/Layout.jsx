import { AppearanceProvider } from "../context/AppearanceContext.jsx";
import "../styles/admin-appearance.css";
import { GALLERY_ENABLED } from "../utils/features.js";
import EnvironmentBadge from "./EnvironmentBadge.jsx";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Bell, Camera, Boxes, CalendarDays, ChevronDown, CircleDollarSign, ContactRound, FileText, Gauge, HeartPulse, Images, LogOut, MessageSquareText, Package, PanelsTopLeft, Plug, Plus, ReceiptText, RadioTower, Search, Settings, ShieldCheck, Sparkles, Menu, X, UserCog, UsersRound, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import NotificationCenter from "./NotificationCenter.jsx";
const navGroups = [{
  label: 'Dashboard',
  icon: Gauge,
  items: [{
    label: 'Overview',
    to: '/',
    permission: 'read:dashboard'
  }, {
    label: 'Reports & Analytics',
    to: '/insights/analytics',
    permission: 'read:analytics'
  }]
}, {
  label: 'CRM',
  icon: ContactRound,
  items: [{
    label: 'Leads',
    to: '/sales/leads',
    permission: 'read:sales'
  }, {
    label: 'Clients',
    to: '/sales/clients',
    permission: 'read:sales'
  }, {
    label: 'Events',
    to: '/events/events',
    permission: 'read:events'
  }, {
    label: 'Tasks',
    to: '/operations/tasks',
    permission: 'read:tasks'
  }]
}, {
  label: 'Sales',
  icon: FileText,
  items: [{
    label: 'Proposals',
    to: '/sales/proposals',
    permission: 'read:sales'
  }, {
    label: 'Agreements',
    to: '/sales/agreements',
    permission: 'read:sales'
  }, {
    label: 'Invoices',
    to: '/finance/invoices',
    permission: 'read:finance'
  }, {
    label: 'Payments',
    to: '/finance/payments',
    permission: 'read:finance'
  }]
}, {
  label: 'Communications',
  icon: MessageSquareText,
  items: [{
    label: 'Messages',
    to: '/sales/communications',
    permission: 'read:sales'
  }, {
    label: 'Campaigns',
    to: '/communications/campaigns',
    permission: 'campaigns.read'
  }, {
    label: 'Templates',
    to: '/sales/communications?section=Templates',
    permission: 'read:sales'
  }, {
    label: 'Scheduled',
    to: '/sales/communications?section=Communications&status=SCHEDULED',
    permission: 'read:sales'
  }, {
    label: 'Automations',
    to: '/sales/communications?section=Automations',
    permission: 'read:sales'
  }]
}, {
  label: 'Operations',
  icon: RadioTower,
  items: [{
    label: 'Calendar',
    to: '/events/calendar',
    permission: 'read:events'
  }, {
    label: 'Live Operations',
    to: '/operations/live',
    permission: 'read:dashboard'
  }, {
    label: 'Staff',
    to: '/events/staff',
    permission: 'read:events'
  }, {
    label: 'Equipment',
    to: '/events/equipment',
    permission: 'read:events'
  }, {
    label: 'Event Galleries',
    to: '/operations/galleries',
    permission: 'read:events',
    gallery: true
  }]
}, {
  label: 'Website',
  icon: PanelsTopLeft,
  items: [{
    label: 'Homepage',
    to: '/website/homepage',
    permission: 'read:website',
    cms: true
  }, {
    label: 'Experiences',
    to: '/website/experiences',
    permission: 'read:website',
    cms: true
  }, {
    label: 'Packages',
    to: '/website/packages',
    permission: 'read:website',
    cms: true
  }, {
    label: 'Gallery',
    to: '/website/gallery',
    permission: 'read:website',
    cms: true
  }, {
    label: 'Testimonials',
    to: '/website/testimonials',
    permission: 'read:website',
    cms: true
  }, {
    label: 'FAQs',
    to: '/website/faq',
    permission: 'read:website',
    cms: true
  }, {
    label: 'Media Library',
    to: '/website/media-library',
    permission: 'read:website',
    cms: true
  }, {
    label: 'SEO & Site Settings',
    to: '/website/site-settings',
    permission: 'read:website',
    cms: true
  }]
}, {
  label: 'Catalog',
  icon: Package,
  items: [{label:'Backdrops',to:'/catalog/backdrops',permission:'read:events'}, {
    label: 'Experiences',
    to: '/content/experiences',
    permission: 'read:content'
  }, {
    label: 'Packages',
    to: '/content/packages',
    permission: 'read:content'
  }, {
    label: 'Add-ons',
    to: '/content/addons',
    permission: 'read:content'
  }]
}, {
  label: 'System',
  icon: Settings,
  items: [{
    label: 'Integrations',
    to: '/system/integrations',
    permission: 'read:integrations'
  }, {
    label: 'Users',
    to: '/system/users',
    permission: 'view:users'
  }, {
    label: 'Audit Log',
    to: '/system/audit-log',
    permission: 'read:audit'
  }, {
    label: 'System Health',
    to: '/system/health',
    permission: 'read:settings'
  }, {
    label: 'Settings',
    to: '/system/settings',
    permission: 'read:settings'
  }]
}];
const routeMatches=(item,pathname,search)=>{
 const [path,query]=item.to.split('?');if(path==='/' )return pathname==='/';
 if(query){const expected=new URLSearchParams(query),actual=new URLSearchParams(search);return pathname===path&&[...expected].every(([key,value])=>actual.get(key)===value);}
 if(path==='/sales/communications'&&search)return new URLSearchParams(search).get('section')!=='Templates'&&new URLSearchParams(search).get('section')!=='Automations'&&new URLSearchParams(search).get('status')!=='SCHEDULED';
 return pathname===path||pathname.startsWith(path+'/');
};

const createItems = [{
  label: "New Lead",
  to: "/sales/leads?create=true",
  permission: "write:sales"
}, {
  label: "New Client",
  to: "/sales/clients?create=true",
  permission: "write:sales"
}, {
  label: "New Event",
  to: "/events/events?create=true",
  permission: "write:events"
}, {
  label: "Create Proposal",
  to: "/sales/proposals/new",
  permission: "write:sales"
}, {
  label: "Create Invoice",
  to: "/finance/invoices/new",
  permission: "write:finance"
}];
export default function Layout() {
  const {
    user,
    logout,
    can
  } = useAuth();
  const navigate = useNavigate();
  const {
    pathname,
    search
  } = useLocation();
  const menuTrigger = useRef(null);
  const createMenu = useRef(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  useEffect(() => {
    setNavigationOpen(false);
    setCreateOpen(false);
  }, [pathname, search]);
  useEffect(() => {
    function dismiss(event) {
      if (event.key === "Escape") {
        if (navigationOpen) menuTrigger.current?.focus();
        setNavigationOpen(false);
        setCreateOpen(false);
      }
    }
    function outside(event) {
      if (!createMenu.current?.contains(event.target)) setCreateOpen(false);
    }
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [navigationOpen]);
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(query)}`).then(result => {
        if (active) setResults(result.data || []);
      }).catch(() => {
        if (active) setResults([]);
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  const visibleGroups = useMemo(() => navGroups.map(g => ({
    ...g,
    items: g.items.filter(item => can(item.permission) && (!item.gallery || GALLERY_ENABLED) && (!item.cms || import.meta.env.VITE_CMS_ENABLED !== "false"))
  })).filter(g => g.items.length), [can]);
  const [expanded, setExpanded] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('lola-nav-groups') || '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    const active = visibleGroups.find(g => g.items.some(i => routeMatches(i, pathname, search)));
    if (active) setExpanded(current => ({
      ...current,
      [active.label]: true
    }));
  }, [pathname, search, visibleGroups]);
  useEffect(() => {
    sessionStorage.setItem('lola-nav-groups', JSON.stringify(expanded));
  }, [expanded]);
  const visibleCreate = createItems.filter(item => can(item.permission));
  function openResult(item) {
    setQuery("");
    if (item.type === "lead") navigate(`/sales/leads/${item.id}`);else if (item.type === "event") navigate(`/events/events/${item.id}`);else if (item.type === "client") navigate(`/sales/clients/${item.id}`);else if (item.type === "proposal") navigate(`/sales/proposals/${item.id}`);else if (item.type === "invoice") navigate(`/finance/invoices/${item.id}`);else navigate("/");
  }
  return <AppearanceProvider><div className="lola-app-shell">
      <a className="lola-skip-link" href="#workspace-content">Skip to content</a>
      <aside id="lola-navigation" className={navigationOpen ? "lola-sidebar open" : "lola-sidebar"}>
        <Link className="lola-brand" to="/" aria-label="LOLA home">
          <strong>LOLA</strong><span>THE LOLA BOOTH</span>
        </Link>

        <button className="lola-nav-close" aria-label="Close navigation" onClick={() => {
        setNavigationOpen(false);
        menuTrigger.current?.focus();
      }}><X size={20} /></button>

        <nav className="lola-nav" aria-label="Main navigation">
          {visibleGroups.map(group => {
          const Icon = group.icon;
          const active = group.items.some(i => routeMatches(i, pathname, search));
          return <div className="lola-nav-group" key={group.label}>
            <button className={active ? 'lola-group-toggle active' : 'lola-group-toggle'} aria-expanded={Boolean(expanded[group.label])} aria-controls={'nav-' + group.label} onClick={() => setExpanded(v => ({
              ...v,
              [group.label]: !v[group.label]
            }))}><Icon size={17} /><span>{group.label}</span><ChevronDown size={14} style={{
                transform: expanded[group.label] ? 'rotate(180deg)' : undefined
              }} /></button>
            {expanded[group.label] && <div className="lola-nav-children" id={'nav-' + group.label}>{group.items.map(item => <Link key={item.to} to={item.to} className={routeMatches(item, pathname, search) ? 'active' : ''} aria-current={routeMatches(item, pathname, search) ? 'page' : undefined}>{item.label}</Link>)}</div>}
          </div>;
        })}
        </nav>

        <div className="lola-sidebar-footer">
          <div className="lola-sidebar-tagline">
            <Camera size={27} aria-hidden="true" />
            <strong>Good people.<br />Better photos.</strong>
          </div>
          <EnvironmentBadge />
        </div>
      </aside>

      <section className="lola-workspace">
        {navigationOpen && <button className="lola-nav-backdrop" aria-label="Close navigation" onClick={() => setNavigationOpen(false)} />}
        <header className="lola-topbar">
          <button ref={menuTrigger} className="lola-mobile-nav-toggle" aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="lola-navigation" onClick={() => setNavigationOpen(v => !v)}><Menu size={20} /></button>
          <div className="lola-search">
            <Search size={18} />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search leads, clients, events, invoices..." aria-label="Global search" />
            {results.length > 0 && <div className="search-results lola-search-results">
                {results.map(item => <button key={`${item.type}-${item.id}`} onClick={() => openResult(item)}>
                    <span>{item.title}</span>
                    <small>{item.type} · {item.subtitle}</small>
                  </button>)}
              </div>}
          </div>

          <div className="lola-topbar-actions">
            {visibleCreate.length > 0 && <div ref={createMenu} className="lola-create-menu">
                <button className="lola-create-button" aria-expanded={createOpen} aria-controls="lola-create-options" aria-label="Create a record" onClick={() => setCreateOpen(v => !v)}>
                  <Plus size={16} /> Create <ChevronDown size={14} />
                </button>
                {createOpen && <div id="lola-create-options" className="lola-create-popover">
                    {visibleCreate.map(item => <button key={item.to} onClick={() => {
                setCreateOpen(false);
                navigate(item.to);
              }}>{item.label}</button>)}
                  </div>}
              </div>}
            <NotificationCenter />
            <Link className="lola-icon-button" aria-label="Appearance & Display" title="Appearance & Display" to="/system/settings?section=appearance"><Sparkles size={17}/></Link>
            <div className="lola-user-chip">
              <span className="lola-avatar">{initials(user?.name)}</span>
              <div><strong>{user?.name || "User"}</strong><small>{user?.roles?.[0] || "Admin"}</small></div>
            </div>
            <button className="lola-icon-button" aria-label="Sign out" onClick={logout}><LogOut size={17} /></button>
          </div>
        </header>
        <div id="workspace-content" tabIndex={-1} className="lola-page-stage">
          <Outlet />
        </div>
      </section>
    </div></AppearanceProvider>;
}
function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "LO";
}
