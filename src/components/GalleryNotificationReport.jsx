import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import "../styles/gallery-notifications.css";
export default function GalleryNotificationReport() {
  const [rows, setRows] = useState([]),
    [filter, setFilter] = useState("ALL"),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api
      .get("/gallery-admin/notifications-report")
      .then((d) => {
        if (active) setRows(Array.isArray(d.rows) ? d.rows : []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const sum = (key) => rows.reduce((n, r) => n + Number(r[key] || 0), 0),
    metric = (key) => rows.reduce((n, r) => n + (r.metrics[key] || 0), 0);
  const money = (value) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 4,
    }).format(value / 1000000);
  return (
    <section className="guest-notifications">
      <h2>Gallery Delivery Report</h2>
      <p>
        Click a metric, then open a Gallery to inspect recipients and delivery
        activity. SMS is simulated in staging.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="gn-metrics">
        {[
          ["ALL", "Published Galleries", rows.length],
          ["EMAIL", "Automatic email notifications", sum("emails")],
          ["SMS", "SMS recipients", sum("sms_recipients")],
          ["SMS", "SMS segments", sum("segments")],
          ["SMS_APPROVED", "SMS approvals", metric("SMS_APPROVED")],
          ["SMS_CANCELED", "SMS cancellations", metric("SMS_CANCELED")],
          ["FAILED", "Failed SMS", sum("sms_failed")],
          [
            "TOKEN_SCOPED_EMAIL_VERIFIED",
            "Email verifications",
            metric("TOKEN_SCOPED_EMAIL_VERIFIED"),
          ],
          [
            "RETURNING_EMAIL_ACCESS",
            "Returning email access",
            metric("RETURNING_EMAIL_ACCESS"),
          ],
          [
            "VOLUNTARY_KEEPSAKES_VISIT",
            "Voluntary Keepsakes visits",
            metric("VOLUNTARY_KEEPSAKES_VISIT"),
          ],
        ].map(([key, label, value]) => (
          <button key={label} onClick={() => setFilter(key)}>
            <small>{label}</small>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
      <p>
        Estimated SMS total: {money(sum("estimated_micros"))} ·
        Provider-recorded cost:{" "}
        {rows.some((r) => r.actual_micros !== null)
          ? money(sum("actual_micros"))
          : "not available"}{" "}
        · Permanent phone ownership associations: deferred. Keepsakes visits
        count voluntary navigation, not marketing conversion.
      </p>
      <div className="gn-table">
        <table>
          <thead>
            <tr>
              <th>Gallery</th>
              <th>Emails</th>
              <th>SMS recipients</th>
              <th>Segments</th>
              <th>Estimated / recorded</th>
              <th>Verifications</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(
                (r) =>
                  filter === "ALL" ||
                  (filter === "EMAIL" && r.emails) ||
                  (filter === "SMS" && r.sms_recipients) ||
                  (filter === "FAILED" && r.sms_failed) ||
                  r.metrics[filter] > 0,
              )
              .map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      to={`/operations/galleries/${r.album_id}?tab=Notifications`}
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td>{r.emails}</td>
                  <td>{r.sms_recipients}</td>
                  <td>{r.segments}</td>
                  <td>
                    {money(Number(r.estimated_micros))} /{" "}
                    {r.actual_micros === null
                      ? "not available"
                      : money(Number(r.actual_micros))}
                  </td>
                  <td>{r.metrics.TOKEN_SCOPED_EMAIL_VERIFIED || 0}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {!rows.length && <p>No published notification records yet.</p>}
      </div>
    </section>
  );
}
