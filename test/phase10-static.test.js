import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../server/migrations/013_phase_10_field_hardening.sql", import.meta.url), "utf8");
const notifications = fs.readFileSync(new URL("../server/src/services/notification-service.js", import.meta.url), "utf8");
const fieldOps = fs.readFileSync(new URL("../server/src/services/field-operations-service.js", import.meta.url), "utf8");
const eventOps = fs.readFileSync(new URL("../server/src/services/event-operations-service.js", import.meta.url), "utf8");
const adminRoutes = fs.readFileSync(new URL("../server/src/routes/admin.js", import.meta.url), "utf8");
const publicRoutes = fs.readFileSync(new URL("../server/src/routes/public.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../src/components/Layout.jsx", import.meta.url), "utf8");
const notificationCenter = fs.readFileSync(new URL("../src/components/NotificationCenter.jsx", import.meta.url), "utf8");
const offlineQueue = fs.readFileSync(new URL("../src/utils/offlineQueue.js", import.meta.url), "utf8");
const myEvents = fs.readFileSync(new URL("../src/pages/MyEvents.jsx", import.meta.url), "utf8");
const eventDetail = fs.readFileSync(new URL("../src/pages/EventDetail.jsx", import.meta.url), "utf8");
const publicDelivery = fs.readFileSync(new URL("../src/pages/PublicDelivery.jsx", import.meta.url), "utf8");
const scan = fs.readFileSync(new URL("../src/pages/Scan.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

test("phase 10 migration creates persistent notifications, preferences, offline receipts, briefs, and delivery tokens", () => {
  for (const token of [
    "CREATE TABLE IF NOT EXISTS notifications",
    "CREATE TABLE IF NOT EXISTS notification_preferences",
    "CREATE TABLE IF NOT EXISTS offline_action_receipts",
    "CREATE TABLE IF NOT EXISTS staff_brief_deliveries",
    "CREATE TABLE IF NOT EXISTS gallery_deliveries",
    "CREATE TABLE IF NOT EXISTS gallery_delivery_items",
    "encode(gen_random_bytes(32), 'hex')",
    "setup_warning_minutes",
    "equipment_return_warning_hours"
  ]) {
    assert.match(migration, new RegExp(token.replace(/[()]/g, "\\$&")));
  }
});

test("phase 10 expands gallery lifecycle and adds constrained operational permissions", () => {
  assert.match(migration, /NOT_STARTED','PROCESSING','READY','DELIVERED','VIEWED','ARCHIVED/);
  for (const permission of ["event.operations.view", "event.incident.create", "equipment.checkout", "equipment.return", "staff.brief.send", "gallery.delivery.send", "read:notifications"]) {
    assert.match(migration, new RegExp(permission.replace(".", "\\.")));
  }
});

test("notification service supports targeting, counts, read, dismiss, preferences, and idempotent offline receipts", () => {
  for (const fn of ["createNotification", "listNotifications", "unreadNotificationCount", "markNotificationRead", "markAllNotificationsRead", "dismissNotification", "getNotificationPreferences", "updateNotificationPreferences", "recordOfflineReceipt"]) {
    assert.match(notifications, new RegExp(`export async function ${fn}`));
  }
  assert.match(notifications, /OWNER_ADMIN/);
  assert.match(notifications, /MANAGERS/);
  assert.match(notifications, /critical_mandatory/);
});

test("field operations service handles offline replay, QR lookup, label PDFs, staff briefs, and delivery portal tokens", () => {
  for (const fn of ["replayOfflineAction", "equipmentScanLookup", "generateEquipmentLabelsPdf", "sendStaffBrief", "createOrSendGalleryDelivery", "publicDelivery", "revokeGalleryDelivery"]) {
    assert.match(fieldOps, new RegExp(`export async function ${fn}`));
  }
  assert.match(fieldOps, /CHECKLIST_UPDATE/);
  assert.match(fieldOps, /STATUS_CHANGE/);
  assert.match(fieldOps, /EQUIPMENT_LIFECYCLE/);
  assert.match(fieldOps, /WRONG_EVENT_EQUIPMENT/);
  assert.match(fieldOps, /GALLERY_DELIVERED/);
  assert.match(fieldOps, /Delivery link unavailable/);
});

test("operational events emit manager and attendant notifications", () => {
  assert.match(eventOps, /createNotification/);
  assert.match(eventOps, /Staff declined assignment/);
  assert.match(eventOps, /Equipment needs attention/);
  assert.match(eventOps, /incident reported/);
  assert.match(eventOps, /Gallery ready/);
  assert.match(eventOps, /Assigned event rescheduled/);
  assert.match(eventOps, /Assigned event cancelled/);
});

test("admin and public APIs expose Phase 10 workflows", () => {
  for (const route of [
    "/notifications",
    "/notifications/count",
    "/offline-actions/replay",
    "/scan/equipment/:token",
    "/equipment/qr-labels.pdf",
    "/events/:id/staff-briefs/send",
    "/events/:id/gallery-delivery/send",
    "/events/:id/gallery-delivery/revoke"
  ]) {
    assert.match(adminRoutes, new RegExp(route.replace(/[/:.]/g, (match) => match === "/" ? "\\/" : ".")));
  }
  assert.match(publicRoutes, /\/delivery\/:token/);
});

test("frontend adds notification center, offline replay, scanner, and branded delivery page", () => {
  assert.match(layout, /NotificationCenter/);
  assert.match(notificationCenter, /Bell/);
  assert.match(notificationCenter, /mark-all-read/);
  assert.match(offlineQueue, /indexedDB/);
  assert.match(myEvents, /offline-actions\/replay/);
  assert.match(myEvents, /OFFLINE/);
  assert.match(myEvents, /Scan Equipment/);
  assert.match(scan, /BarcodeDetector/);
  assert.match(publicDelivery, /LOLA_Primary_Dark_Transparent\.png/);
  assert.match(app, /\/delivery\/:token/);
  assert.match(app, /\/scan/);
});

test("event detail exposes QR labels, staff brief delivery, and gallery delivery controls", () => {
  assert.match(eventDetail, /Download QR Labels/);
  assert.match(eventDetail, /Send Staff Brief/);
  assert.match(eventDetail, /Send Gallery/);
  assert.match(eventDetail, /Revoke Delivery/);
  assert.match(eventDetail, /downloadPost/);
});

test("phase 10 styles support notifications and offline sync indicators", () => {
  for (const token of [".notification-center", ".notification-panel", ".notification-item", ".offline-indicator", ".icon-button"]) {
    assert.match(styles, new RegExp(token.replace(".", "\\.")));
  }
});
