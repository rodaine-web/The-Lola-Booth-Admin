import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { BarChart3, BriefcaseBusiness, CalendarDays, CircleDollarSign, ClipboardList, Gauge, HeartPulse, LogOut, Package, Search, Shield, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import NotificationCenter from "./NotificationCenter.jsx";

const sections = [
  { label: "Dashboard", icon: Gauge, items: [{ label: "Dashboard", to: "/", permission: "read:dashboard" }] },
  { label: "Sales", icon: BriefcaseBusiness, items: [{ label: "Leads", to: "/sales/leads", permission: "read:sales" }, { label: "Clients", to: "/sales/clients", permission: "read:sales" }, { label: "Proposals", to: "/sales/proposals", permission: "read:sales" }, { label: "Communications", to: "/sales/communications", permission: "read:sales" }] },
  { label: "Events", icon: CalendarDays, items: [{ label: "Events", to: "/events/events", permission: "read:events" }, { label: "Calendar", to: "/events/calendar", permission: "read:events" }, { label: "Equipment", to: "/events/equipment", permission: "read:events" }, { label: "Staff", to: "/events/staff", permission: "read:events" }] },
  { label: "Finance", icon: CircleDollarSign, items: [{ label: "Payments", to: "/finance/payments", permission: "read:finance" }, { label: "Invoices", to: "/finance/invoices", permission: "read:finance" }] },
  { label: "Website", icon: Sparkles, items: [{ label: "Homepage", to: "/website/homepage", permission: "read:website" }, { label: "Hero Slides", to: "/website/hero-slides", permission: "read:website" }, { label: "Gallery", to: "/website/gallery", permission: "read:website" }, { label: "Packages", to: "/website/packages", permission: "read:website" }, { label: "Experiences", to: "/website/experiences", permission: "read:website" }, { label: "Events", to: "/website/events", permission: "read:website" }, { label: "Testimonials", to: "/website/testimonials", permission: "read:website" }, { label: "FAQ", to: "/website/faq", permission: "read:website" }, { label: "Media Library", to: "/website/media-library", permission: "read:website" }, { label: "SEO / Site Settings", to: "/website/site-settings", permission: "read:website" }] },
  { label: "Content", icon: Package, items: [{ label: "Packages", to: "/content/packages", permission: "read:content" }, { label: "Experiences", to: "/content/experiences", permission: "read:content" }, { label: "Add-ons", to: "/content/addons", permission: "read:content" }] },
  { label: "Operations", icon: ClipboardList, items: [{ label: "Live", to: "/operations/live", permission: "read:dashboard" }, { label: "Tasks", to: "/operations/tasks", permission: "read:tasks" }, { label: "Files", to: "/operations/files", permission: "read:tasks" }, { label: "Galleries", to: "/operations/galleries", permission: "read:tasks" }] },
  { label: "Insights", icon: BarChart3, items: [{ label: "Analytics", to: "/insights/analytics", permission: "read:analytics" }] },
  { label: "System", icon: Shield, items: [{ label: "Users", to: "/system/users", permission: "read:settings" }, { label: "Integrations", to: "/system/integrations", permission: "read:integrations" }, { label: "Health", to: "/system/health", permission: "read:settings", icon: HeartPulse }, { label: "Audit Log", to: "/system/audit-log", permission: "read:audit" }, { label: "Settings", to: "/system/settings", permission: "read:settings" }] }
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(query)}`).then((result) => setResults(result.data)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo brand-logo-admin-stacked" src="/brand/LOLA_Primary_Dark_Transparent.png" alt="The LOLA Booth" />
          <div>
            <span>Admin Portal</span>
          </div>
        </div>
        <nav>
          {sections.map((section) => {
            const visibleItems = section.items.filter((item) => can(item.permission));
            if (!visibleItems.length) return null;
            const Icon = section.icon;
            return (
              <div className="nav-section" key={section.label}>
                <p><Icon size={15} />{section.label}</p>
                {visibleItems.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.to === "/"}>{item.label}</NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="searchbox">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients, leads, events, invoices..." />
            {results.length > 0 && (
              <div className="search-results">
                {results.map((item) => (
                  <button key={`${item.type}-${item.id}`} onClick={() => { setQuery(""); navigate(item.type === "lead" ? `/sales/leads/${item.id}` : item.type === "event" ? `/events/events/${item.id}` : item.type === "client" ? `/sales/clients/${item.id}` : "/finance/invoices"); }}>
                    <span>{item.title}</span>
                    <small>{item.type} · {item.subtitle}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="user-menu">
            <NotificationCenter />
            <Sparkles size={16} />
            <span>{user?.name}</span>
            <button aria-label="Sign out" onClick={logout}><LogOut size={17} /></button>
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
