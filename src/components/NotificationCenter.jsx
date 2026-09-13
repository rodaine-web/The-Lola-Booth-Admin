import { Bell, CheckCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";

const categories = ["", "LEADS", "SALES", "PAYMENTS", "EVENTS", "STAFF", "EQUIPMENT", "INCIDENTS", "SYSTEM"];

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [payload, setPayload] = useState({ data: [], unread: 0 });

  useEffect(() => {
    load();
    const timer = setInterval(load, 45000);
    return () => clearInterval(timer);
  }, [category, unreadOnly]);

  async function load() {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (unreadOnly) params.set("unread", "true");
    api.get(`/notifications${params.size ? `?${params}` : ""}`).then(setPayload).catch(() => null);
  }

  async function markAllRead() {
    await api.post("/notifications/mark-all-read", {});
    await load();
  }

  async function read(id) {
    await api.patch(`/notifications/${id}/read`, {});
    await load();
  }

  async function dismiss(id) {
    await api.delete(`/notifications/${id}`);
    await load();
  }

  return (
    <div className="notification-center">
      <button className="icon-button notification-bell" aria-label="Notifications" onClick={() => setOpen((value) => !value)}>
        <Bell size={17} />
        {payload.unread > 0 && <span>{payload.unread}</span>}
      </button>
      {open && (
        <div className="notification-panel">
          <div className="notification-heading">
            <h2>Notifications</h2>
            <button onClick={markAllRead}><CheckCheck size={15} />Read All</button>
          </div>
          <div className="notification-filters">
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => <option key={item} value={item}>{item || "All categories"}</option>)}
            </select>
            <label className="check-row"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />Unread</label>
          </div>
          <div className="notification-list">
            {payload.data.length ? payload.data.map((item) => (
              <article key={item.id} className={`notification-item ${item.severity.toLowerCase()} ${item.read_at ? "read" : ""}`}>
                <div>
                  <small>{item.category} · {item.severity}</small>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  {item.action_url && <a className="inline-link" href={item.action_url} onClick={() => read(item.id)}>Open</a>}
                </div>
                <button aria-label="Dismiss notification" onClick={() => dismiss(item.id)}><X size={15} /></button>
              </article>
            )) : <div className="empty-state">No notifications.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
