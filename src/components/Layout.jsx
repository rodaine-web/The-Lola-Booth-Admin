import { GALLERY_ENABLED } from "../utils/features.js";
import EnvironmentBadge from "./EnvironmentBadge.jsx";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3, Bell, Camera, Boxes, CalendarDays, ChevronDown, CircleDollarSign, ContactRound,
  FileText, Gauge, HeartPulse, Images, LogOut, MessageSquareText, Package, PanelsTopLeft,
  Plug, Plus, ReceiptText, RadioTower, Search, Settings, ShieldCheck, Sparkles, Menu, X,
  UserCog, UsersRound, Wrench
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import NotificationCenter from "./NotificationCenter.jsx";

const navItems = [
  { label: "Dashboard", to: "/", icon: Gauge, permission: "read:dashboard" },
  { label: "Leads", to: "/sales/leads", icon: UsersRound, permission: "read:sales" },
  { label: "Clients", to: "/sales/clients", icon: ContactRound, permission: "read:sales" },
  { label: "Events", to: "/events/events", icon: CalendarDays, permission: "read:events" },
  { label: "Proposals", to: "/sales/proposals", icon: FileText, permission: "read:sales" },
  { label: "Invoices", to: "/finance/invoices", icon: ReceiptText, permission: "read:finance" },
  { label: "Payments", to: "/finance/payments", icon: CircleDollarSign, permission: "read:finance" },
  { label: "Calendar", to: "/events/calendar", icon: CalendarDays, permission: "read:events" },
  { label: "Live Operations", to: "/operations/live", icon: RadioTower, permission: "read:dashboard" },
  { label: "Communications", to: "/sales/communications", icon: MessageSquareText, permission: "read:sales" },
  { label: "Gallery", to: "/operations/galleries", icon: Images, permission: "read:events", gallery: true },
  { label: "Website CMS", to: "/website/homepage", icon: PanelsTopLeft, permission: "read:website", cms: true },
  { label: "Experiences", to: "/content/experiences", icon: Sparkles, permission: "read:content" },
  { label: "Packages", to: "/content/packages", icon: Package, permission: "read:content" },
  { label: "Add-ons", to: "/content/addons", icon: Boxes, permission: "read:content" },
  { label: "Staff", to: "/events/staff", icon: UsersRound, permission: "read:events" },
  { label: "Equipment", to: "/events/equipment", icon: Wrench, permission: "read:events" },
  { label: "Reports & Analytics", to: "/insights/analytics", icon: BarChart3, permission: "read:analytics" },
  { label: "Integrations", to: "/system/integrations", icon: Plug, permission: "read:integrations" },
  { label: "Users", to: "/system/users", icon: UserCog, permission: "view:users" },
  { label: "System Health", to: "/system/health", icon: HeartPulse, permission: "read:settings" },
  { label: "Audit Log", to: "/system/audit-log", icon: ShieldCheck, permission: "read:audit" },
  { label: "Settings", to: "/system/settings", icon: Settings, permission: "read:settings" }
];

const createItems = [
  { label: "New Lead", to: "/sales/leads?create=true", permission: "write:sales" },
  { label: "New Client", to: "/sales/clients?create=true", permission: "write:sales" },
  { label: "New Event", to: "/events/events?create=true", permission: "write:events" },
  { label: "Create Proposal", to: "/sales/proposals/new", permission: "write:sales" },
  { label: "Create Invoice", to: "/finance/invoices/new", permission: "write:finance" }
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
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
      api.get(`/search?q=${encodeURIComponent(query)}`)
        .then((result) => { if (active) setResults(result.data || []); })
        .catch(() => { if (active) setResults([]); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  const visibleNav = useMemo(() => navItems.filter(item => {
    if (!can(item.permission)) return false;
    if (item.gallery && !GALLERY_ENABLED) return false;
    if (item.cms && import.meta.env.VITE_CMS_ENABLED === "false") return false;
    return true;
  }), [can]);

  const visibleCreate = createItems.filter(item => can(item.permission));

  function openResult(item) {
    setQuery("");
    if (item.type === "lead") navigate(`/sales/leads/${item.id}`);
    else if (item.type === "event") navigate(`/events/events/${item.id}`);
    else if (item.type === "client") navigate(`/sales/clients/${item.id}`);
    else if (item.type === "proposal") navigate(`/sales/proposals/${item.id}`);
    else if (item.type === "invoice") navigate(`/finance/invoices/${item.id}`);
    else navigate("/");
  }

  return (
    <div className="lola-app-shell">
      <a className="lola-skip-link" href="#workspace-content">Skip to content</a>
      <aside id="lola-navigation" className={navigationOpen ? "lola-sidebar open" : "lola-sidebar"}>
        <Link className="lola-brand" to="/" aria-label="LOLA home">
          <strong>LOLA</strong><span>THE LOLA BOOTH</span>
        </Link>

        <button className="lola-nav-close" aria-label="Close navigation" onClick={() => { setNavigationOpen(false); menuTrigger.current?.focus(); }}><X size={20}/></button>

        <nav className="lola-nav" aria-label="Main navigation">
          {visibleNav.map(item => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} title={item.label} aria-label={item.label} end={item.to === "/"} className={({isActive}) => isActive ? "active" : ""}>
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="lola-sidebar-footer">
          <div className="lola-sidebar-tagline">
            <Camera size={27} aria-hidden="true" />
            <strong>Good people.<br/>Better photos.</strong>
          </div>
          <EnvironmentBadge />
        </div>
      </aside>

      <section className="lola-workspace">
        {navigationOpen && <button className="lola-nav-backdrop" aria-label="Close navigation" onClick={() => setNavigationOpen(false)} />}
        <header className="lola-topbar">
          <button ref={menuTrigger} className="lola-mobile-nav-toggle" aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="lola-navigation" onClick={() => setNavigationOpen(v => !v)}><Menu size={20}/></button>
          <div className="lola-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search leads, clients, events, invoices..."
              aria-label="Global search"
            />
            {results.length > 0 && (
              <div className="search-results lola-search-results">
                {results.map(item => (
                  <button key={`${item.type}-${item.id}`} onClick={() => openResult(item)}>
                    <span>{item.title}</span>
                    <small>{item.type} · {item.subtitle}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lola-topbar-actions">
            {visibleCreate.length > 0 && (
              <div ref={createMenu} className="lola-create-menu">
                <button className="lola-create-button" aria-expanded={createOpen} aria-controls="lola-create-options" aria-label="Create a record" onClick={() => setCreateOpen(v => !v)}>
                  <Plus size={16} /> Create <ChevronDown size={14} />
                </button>
                {createOpen && (
                  <div id="lola-create-options" className="lola-create-popover">
                    {visibleCreate.map(item => <button key={item.to} onClick={() => { setCreateOpen(false); navigate(item.to); }}>{item.label}</button>)}
                  </div>
                )}
              </div>
            )}
            <NotificationCenter />
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
    </div>
  );
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]?.toUpperCase()).join("") || "LO";
}
