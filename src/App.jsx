import AuditLog from "./pages/AuditLog.jsx";
import Roster from "./pages/Roster.jsx";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import SetupPassword from "./pages/SetupPassword.jsx";

const WebsiteDiagnostics = lazy(() => import("./pages/WebsiteDiagnostics.jsx"));
const Users = lazy(() => import("./pages/Users.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Leads = lazy(() => import("./pages/Leads.jsx"));
const LeadDetail = lazy(() => import("./pages/LeadDetail.jsx"));
const EventDetail = lazy(() => import("./pages/EventDetail.jsx"));
const ClientDetail = lazy(() => import("./pages/ClientDetail.jsx"));
const Calendar = lazy(() => import("./pages/Calendar.jsx"));
const Analytics = lazy(() => import("./pages/Analytics.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const ResourcePage = lazy(() => import("./pages/ResourcePage.jsx"));
const Proposals = lazy(() => import("./pages/Proposals.jsx"));
const ProposalEditor = lazy(() => import("./pages/ProposalEditor.jsx"));
const ProposalDetail = lazy(() => import("./pages/ProposalDetail.jsx"));
const Invoices = lazy(() => import("./pages/Invoices.jsx"));
const InvoiceEditor = lazy(() => import("./pages/InvoiceEditor.jsx"));
const InvoiceDetail = lazy(() => import("./pages/InvoiceDetail.jsx"));
const Payments = lazy(() => import("./pages/Payments.jsx"));
const PaymentDetail = lazy(() => import("./pages/PaymentDetail.jsx"));
const PublicProposal = lazy(() => import("./pages/PublicProposal.jsx"));
const PublicInvoice = lazy(() => import("./pages/PublicInvoice.jsx"));
const Integrations = lazy(() => import("./pages/Integrations.jsx"));
const WebsiteCms = lazy(() => import("./pages/WebsiteCms.jsx"));
const Communications = lazy(() => import("./pages/Communications.jsx"));
const MyEvents = lazy(() => import("./pages/MyEvents.jsx"));
const PublicDelivery = lazy(() => import("./pages/PublicDelivery.jsx"));
const Scan = lazy(() => import("./pages/Scan.jsx"));
const LiveOperations = lazy(() => import("./pages/LiveOperations.jsx"));
const SystemHealth = lazy(() => import("./pages/SystemHealth.jsx"));

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="boot-screen">Opening Admin Portal...</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.roles?.includes("ATTENDANT") && !user.roles?.some((role) => ["OWNER", "ADMIN", "SUPER_ADMIN", "EVENT_MANAGER"].includes(role)) && !location.pathname.startsWith("/my-events")) {
    return <Navigate to="/my-events" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<main className="boot-screen">Opening Admin Portal...</main>}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup-password" element={<SetupPassword />} />
      <Route path="/proposal/:token" element={<PublicProposal />} />
      <Route path="/invoice/:token" element={<PublicInvoice />} />
      <Route path="/delivery/:token" element={<PublicDelivery />} />
      <Route path="/my-events" element={<PrivateRoute><MyEvents /></PrivateRoute>} />
      <Route path="/my-events/:eventId" element={<PrivateRoute><MyEvents /></PrivateRoute>} />
      <Route path="/scan" element={<PrivateRoute><Scan /></PrivateRoute>} />
      <Route path="/scan/equipment/:token" element={<PrivateRoute><Scan /></PrivateRoute>} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="sales/leads" element={<Leads />} />
        <Route path="sales/leads/:id" element={<LeadDetail />} />
        <Route path="sales/clients" element={<ResourcePage title="Clients" endpoint="/clients" columns={["name", "email", "phone", "client_type"]} rowHref={(row) => `/sales/clients/${row.id}`} fields={clientFields} />} />
        <Route path="sales/clients/:id" element={<ClientDetail />} />
        <Route path="sales/proposals" element={<Proposals />} />
        <Route path="sales/communications" element={<Communications />} />
        <Route path="sales/proposals/:id/edit" element={<ProposalEditor />} />
        <Route path="sales/proposals/new" element={<ProposalEditor />} />
        <Route path="sales/proposals/:id" element={<ProposalDetail />} />
        <Route path="events/events" element={<ResourcePage title="Events" endpoint="/events" columns={["event_number", "event_name", "event_date", "venue_name", "status"]} rowHref={(row) => `/events/events/${row.id}`} fields={eventFields} />} />
        <Route path="events/events/:id" element={<EventDetail />} />
        <Route path="events/calendar" element={<Calendar />} />
        <Route path="events/equipment" element={<Roster kind="equipment"/>} />
        <Route path="events/staff" element={<Roster kind="staff"/>} />
        <Route path="finance/payments" element={<Payments />} />
        <Route path="finance/payments/:id" element={<PaymentDetail />} />
        <Route path="finance/invoices" element={<Invoices />} />
        <Route path="finance/invoices/:id/edit" element={<InvoiceEditor />} />
        <Route path="finance/invoices/new" element={<InvoiceEditor />} />
        <Route path="finance/invoices/:id" element={<InvoiceDetail />} />
        <Route path="website/page-items" element={<WebsiteCms section="pageItems" />} />
        <Route path="website/media-mappings" element={<WebsiteCms section="mediaMappings" />} />
        <Route path="website/connection" element={<WebsiteDiagnostics />} />
        <Route path="website/homepage" element={<WebsiteCms section="homepage" />} />
        <Route path="website/hero-slides" element={<WebsiteCms section="hero" />} />
        <Route path="website/gallery" element={<WebsiteCms section="gallery" />} />
        <Route path="website/packages" element={<ResourcePage title="Website Packages" endpoint="/packages" phase="Website CMS" columns={["name", "website_key", "starting_price", "pricing_mode", "website_status", "most_popular"]} fields={packageFields} />} />
        <Route path="website/experiences" element={<ResourcePage title="Website Experiences" endpoint="/experiences" phase="Website CMS" columns={["name", "website_name", "show_on_website", "website_featured", "active"]} fields={experienceFields} />} />
        <Route path="website/events" element={<WebsiteCms section="events" />} />
        <Route path="website/testimonials" element={<WebsiteCms section="testimonials" />} />
        <Route path="website/faq" element={<WebsiteCms section="faqs" />} />
        <Route path="website/media-library" element={<WebsiteCms section="media" />} />
        <Route path="website/site-settings" element={<WebsiteCms section="settings" />} />
        <Route path="content/packages" element={<ResourcePage title="Packages" endpoint="/packages" columns={["name", "starting_price", "most_popular", "active"]} fields={packageFields} />} />
        <Route path="content/experiences" element={<ResourcePage title="Experiences" endpoint="/experiences" columns={["name", "base_price", "default_duration", "active"]} fields={experienceFields} />} />
        <Route path="content/addons" element={<ResourcePage title="Add-ons" endpoint="/addons" columns={["name", "price", "pricing_type", "active"]} fields={addonFields} />} />
        <Route path="operations/live" element={<LiveOperations />} />
        <Route path="operations/tasks" element={<ResourcePage title="Tasks" endpoint="/tasks" columns={["title", "owner_name", "event_name", "client_name", "due_date", "priority", "status"]} fields={taskFields} />} />
        <Route path="operations/files" element={<ResourcePage title="Files" endpoint="/files" phase="Metadata model ready" columns={["filename", "category", "storage_provider", "created_at"]} />} />
        <Route path="operations/galleries" element={<ResourcePage title="Galleries" endpoint="/galleries" phase="Manual URL records" columns={["gallery_name", "gallery_url", "delivery_date", "status"]} />} />
        <Route path="insights/analytics" element={<Analytics />} />
        <Route path="system/users" element={<Users />} />
        <Route path="system/integrations" element={<Integrations />} />
        <Route path="system/health" element={<SystemHealth />} />
        <Route path="system/audit-log" element={<AuditLog/>} />
        <Route path="system/settings" element={<Settings />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

const clientFields = [
  ["first_name", "First name"], ["last_name", "Last name"], ["email", "Email", "email"], ["phone", "Phone"], ["company", "Company"], ["preferred_contact_method", "Preferred contact method"], ["address", "Address"], ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["notes", "Notes", "textarea"]
];

const eventFields = [
  ["client_id", "Client", "relationship", { resource: "clients" }], ["event_name", "Event title"], ["event_type", "Event type"], ["event_date", "Event date", "date"], ["start_time", "Start time", "time"], ["end_time", "End time", "time"], ["setup_time", "Setup time", "time"], ["breakdown_time", "Breakdown time", "time"], ["venue_name", "Venue"], ["venue_address", "Address"], ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["guest_count", "Guest count", "number"], ["package_id", "Package", "relationship", { resource: "packages" }], ["experience_id", "Experience", "relationship", { resource: "experiences" }], ["internal_notes", "Internal notes", "textarea"], ["client_notes", "Client notes", "textarea"]
];

const packageFields = [
  ["experience_id", "Experience", "relationship", { resource: "experiences" }], ["website_key", "Website identity (for example glam:essential)"], ["pricing_mode", "Pricing mode", "select", { options: ["STARTING", "CUSTOM"] }], ["website_status", "Website publish status", "select", { options: ["DRAFT", "PUBLISHED", "ARCHIVED"] }], ["website_features", "Website features (one per line)", "lines"], ["website_custom_heading", "Custom package heading"], ["website_home_description", "Homepage description", "textarea"],
  ["name", "Name"], ["description", "Description", "textarea"], ["short_description", "Short description"], ["starting_price", "Starting price", "number"], ["currency", "Currency"], ["active", "Active", "checkbox"], ["featured", "Featured", "checkbox"], ["most_popular", "Most popular", "checkbox"], ["display_order", "Display order", "number"], ["duration", "Duration", "number"], ["included_hours", "Included hours", "number"], ["default_deposit", "Default deposit", "number"], ["proposal_description", "Proposal description", "textarea"], ["website_description", "Website description", "textarea"], ["show_on_website", "Show on website", "checkbox"], ["website_short_description", "Website short description", "textarea"], ["website_image_media_id", "Website image media ID"], ["website_display_order", "Website display order", "number"], ["website_featured", "Website featured", "checkbox"]
];

const experienceFields = [
  ["website_status", "Website publish status", "select", {options:["DRAFT","PUBLISHED","ARCHIVED"]}],
  ["name", "Name"], ["slug", "Slug"], ["description", "Description", "textarea"], ["proposal_description", "Proposal description", "textarea"], ["base_price", "Base price", "number"], ["default_duration", "Default duration", "number"], ["setup_duration", "Setup duration", "number"], ["breakdown_duration", "Breakdown duration", "number"], ["staff_required", "Staff required", "number"], ["active", "Active", "checkbox"], ["display_order", "Display order", "number"], ["show_on_website", "Show on website", "checkbox"], ["website_name", "Website name"], ["website_short_description", "Website short description", "textarea"], ["website_long_description", "Website long description", "textarea"], ["website_heading", "Page heading"], ["website_label", "Page label"], ["website_kicker", "Supporting line"], ["website_featured", "Website featured", "checkbox"], ["cover_image_media_id", "Cover image media ID"]
];

const addonFields = [
  ["name", "Name"], ["description", "Description", "textarea"], ["price", "Price", "number"], ["pricing_type", "Pricing type"], ["taxable", "Taxable", "checkbox"], ["active", "Active", "checkbox"], ["display_order", "Display order", "number"], ["proposal_description", "Proposal description", "textarea"]
];

const taskFields = [
  ["title", "Title"], ["description", "Description", "textarea"], ["due_date", "Due date", "date"], ["assigned_user_id", "Owner", "relationship", { resource: "users" }], ["lead_id", "Lead", "relationship", { resource: "leads" }], ["client_id", "Client", "relationship", { resource: "clients" }], ["event_id", "Event", "relationship", { resource: "events" }], ["status", "Status", "select", { options: ["OPEN","IN_PROGRESS","DONE","CANCELLED"] }], ["priority", "Priority", "select", { options: ["LOW","NORMAL","HIGH","URGENT"] }]
];

const paymentFields = [
  ["event_id", "Event", "relationship", { resource: "events" }], ["client_id", "Client", "relationship", { resource: "clients" }], ["invoice_id", "Invoice", "relationship", { resource: "invoices" }], ["amount", "Amount", "number"], ["payment_method", "Payment method"], ["reference_number", "Reference number"], ["payment_date", "Payment date", "date"], ["notes", "Notes", "textarea"]
];
