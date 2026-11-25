import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import "../styles/gallery-notifications.css";
const money = (n) =>
  n === null || n === undefined
    ? "Not configured"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
      }).format(Number(n) / 1000000);
export default function GalleryGuestNotifications({
  albumId,
  canApprove = false,
  reviewRequest = 0,
  onReviewed = () => {},
}) {
  const [data, setData] = useState(null),
    [review, setReview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("ALL"),
    [config, setConfig] = useState(null),
    [providerStatus, setProviderStatus] = useState(null),
    [contacts, setContacts] = useState(null),
    [notice, setNotice] = useState("");
  const dialog = useRef(null),
    cancelButton = useRef(null);
  const base = `/gallery-admin/albums/${albumId}`;
  async function load() {
    setData(await api.get(base + "/notifications"));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [albumId]);
  async function openReview() {
    setBusy(true);
    setError("");
    try {
      setReview(await api.post(base + "/notifications/review", {}));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      onReviewed();
    }
  }
  useEffect(() => {
    if (reviewRequest) openReview();
  }, [reviewRequest]);
  useEffect(() => {
    if (!review) return;
    const old = document.activeElement;
    dialog.current.showModal();
    cancelButton.current?.focus();
    return () => {
      dialog.current?.close();
      old?.focus();
    };
  }, [review?.id]);
  async function decide(decision) {
    setBusy(true);
    setError("");
    try {
      const result = await api.post(base + "/notifications/decision", {
        reviewId: review.id,
        decision,
      });
      setReview(null);
      setNotice(
        decision === "CANCELED"
          ? "SMS notifications were not sent. The Gallery and email delivery remain available."
          : `${result.recipients ?? 0} recipients approved for staging simulation. No SMS will leave staging.`,
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function setup() {
    setBusy(true);
    try {
      const result = await api.get("/gallery-admin/notification-settings");
      setConfig(result.config);
      setProviderStatus(result.credentials);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put("/gallery-admin/notification-settings", config);
      setConfig(null);
      setNotice(
        "Notification settings saved. Review recipients and costs again before approval.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function authorize(c) {
    const evidence = window.prompt(
      "Record the source, date and wording of the guest’s authorization for transactional photo delivery. Marketing consent is separate.",
      c.evidence || "",
    );
    if (!evidence) return;
    setBusy(true);
    try {
      await api.put(base + "/notification-authorization", {
        personId: c.personId,
        channel: c.channel,
        evidence,
        authorized: !c.authorized,
      });
      setContacts(await api.get(base + "/notification-contacts"));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const deliveries = data?.deliveries || [],
    events = data?.events || [],
    count = (channel, status) =>
      deliveries.filter(
        (d) =>
          d.channel === channel &&
          (!status ||
            d.status === status ||
            (channel === "EMAIL" && d.email_status === status)),
      ).length;
  const metrics = [
    ["EMAIL", "Eligible", data?.eligibleEmail || 0],
    ["EMAIL", "Queued", count("EMAIL", "QUEUED")],
    ["EMAIL", "Sent to provider", count("EMAIL", "SENT_TO_PROVIDER")],
    ["EMAIL", "Failed", count("EMAIL", "FAILED")],
    ["EMAIL", "Delivered", count("EMAIL", "DELIVERED")],
    ["SMS", "Eligible", data?.eligibleSms || 0],
    ["SMS", "Approved", count("SMS", "APPROVED")],
    ["SMS", "Sending", count("SMS", "SUBMITTING")],
    ["SMS", "Sent", count("SMS", "SENT")],
    ["SMS", "Delivered", count("SMS", "DELIVERED")],
    ["SMS", "Failed", count("SMS", "FAILED") + count("SMS", "UNDELIVERED")],
    ["SMS", "Simulated", count("SMS", "SIMULATED")],
    ["SMS", "Needs review", count("SMS", "UNKNOWN")],
  ];
  return (
    <section className="guest-notifications">
      <header>
        <div>
          <p className="eyebrow">GALLERY DELIVERY</p>
          <h2>Guest Photo Notifications</h2>
          <p>Email and SMS are managed independently.</p>
        </div>
        <div className="gn-actions">
          <button
            disabled={busy}
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Refresh Status
          </button>
          {canApprove && (
            <>
              <button disabled={busy} onClick={setup}>
                Notification Settings
              </button>
              <button
                className="primary-action"
                disabled={busy || !data?.published}
                onClick={openReview}
              >
                Review SMS Delivery
              </button>
            </>
          )}
        </div>
      </header>
      <p className="gn-mode">
        Staging simulation · SMS cannot reach guests. Email is limited to
        approved test inboxes.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data?.published && (
        <p>
          Publish the Gallery to queue authorized email notifications and review
          SMS delivery.
        </p>
      )}
      {events.find((e) => e.kind === "SMS_CANCELED") &&
        !events.find((e) => e.kind === "SMS_APPROVED") && (
          <p>SMS notifications were not sent.</p>
        )}
      <div className="gn-metrics">
        {metrics.map(([channel, label, n]) => (
          <button
            key={channel + label}
            onClick={() => {
              const status = {
                Queued: "QUEUED",
                "Sent to provider": "SENT_TO_PROVIDER",
                Failed: "FAILED",
                Delivered: "DELIVERED",
                Approved: "APPROVED",
                Sending: "SUBMITTING",
                Sent: "SENT",
                Simulated: "SIMULATED",
                "Needs review": "UNKNOWN",
              }[label];
              setFilter(status ? channel + ":" + status : channel);
            }}
            aria-label={`Inspect ${channel} ${label}`}
          >
            <small>
              {channel} · {label}
            </small>
            <strong>{n}</strong>
          </button>
        ))}
      </div>
      <div className="gn-totals">
        <button onClick={() => setFilter("SMS")}>
          Estimated SMS cost{" "}
          <strong>
            {money(
              deliveries
                .filter((d) => d.channel === "SMS")
                .reduce((s, d) => s + Number(d.estimated_micros), 0),
            )}
          </strong>
        </button>
        <button onClick={() => setFilter("SMS")}>
          Provider-recorded cost{" "}
          <strong>
            {deliveries.some(
              (d) => d.actual_micros !== null && d.actual_micros !== undefined,
            )
              ? money(
                  deliveries.reduce(
                    (s, d) => s + Number(d.actual_micros || 0),
                    0,
                  ),
                )
              : "Not yet available"}
          </strong>
        </button>
        <button onClick={() => setFilter("EVENTS")}>
          Email verifications{" "}
          <strong>
            {data?.metrics?.TOKEN_SCOPED_EMAIL_VERIFIED ||
              events.filter((e) => e.kind === "TOKEN_SCOPED_EMAIL_VERIFIED")
                .length}
          </strong>
        </button>
        <button onClick={() => setFilter("EVENTS")}>
          Approvals / cancellations{" "}
          <strong>
            {data?.metrics?.SMS_APPROVED ||
              events.filter((e) => e.kind === "SMS_APPROVED").length}{" "}
            /{" "}
            {data?.metrics?.SMS_CANCELED ||
              events.filter((e) => e.kind === "SMS_CANCELED").length}
          </strong>
        </button>
      </div>
      <nav aria-label="Notification records">
        {["ALL", "EMAIL", "SMS", "EVENTS"].map((v) => (
          <button
            key={v}
            aria-pressed={filter === v}
            onClick={() => setFilter(v)}
          >
            {v === "EVENTS" ? "Activity" : v}
          </button>
        ))}
        {canApprove && (
          <button
            disabled={busy}
            onClick={async () => {
              try {
                setContacts(await api.get(base + "/notification-contacts"));
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Review Contact Authorization
          </button>
        )}
      </nav>
      {filter === "EVENTS" ? (
        <div className="gn-table">
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>When</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.kind.replaceAll("_", " ")}</td>
                  <td>{new Date(e.created_at).toLocaleString()}</td>
                  <td>{JSON.stringify(e.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="gn-table">
          <table>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Segments</th>
                <th>Estimated / recorded</th>
                <th>Updated</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {deliveries
                .filter((d) => {
                  const [channel, status] = filter.split(":");
                  if (filter === "ALL") return true;
                  if (d.channel !== channel) return false;
                  if (!status) return true;
                  const actual =
                    d.channel === "EMAIL" &&
                    d.status !== "QUEUED" &&
                    d.status !== "FAILED"
                      ? d.email_status || d.status
                      : d.status;
                  return (
                    actual === status ||
                    (status === "FAILED" && actual === "UNDELIVERED")
                  );
                })
                .map((d) => (
                  <tr key={d.id}>
                    <td>{d.recipient}</td>
                    <td>{d.channel}</td>
                    <td>
                      {(d.channel === "EMAIL"
                        ? ["QUEUED", "FAILED", "SUPPRESSED"].includes(d.status)
                          ? d.status
                          : d.email_status || d.status
                        : d.status
                      ).replaceAll("_", " ")}
                    </td>
                    <td>{d.channel === "SMS" ? d.segments : "—"}</td>
                    <td>
                      {d.channel === "SMS"
                        ? `${money(d.estimated_micros)} / ${money(d.actual_micros)}`
                        : "—"}
                    </td>
                    <td>{new Date(d.updated_at).toLocaleString()}</td>
                    <td>{d.failure_code || d.email_failure_code || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!deliveries.length && <p>No notifications have been queued.</p>}
        </div>
      )}
      {contacts && (
        <section>
          <h3>Transactional photo-delivery authorization</h3>
          <p>
            Record explicit guest authorization or another reviewed basis.
            Importing a phone or email does not authorize messages. STOP
            suppression cannot be bypassed here.
          </p>
          <div className="gn-table">
            <table>
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Contact</th>
                  <th>Channel</th>
                  <th>Authorization</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.personId + c.channel}>
                    <td>{c.name}</td>
                    <td>{c.recipient}</td>
                    <td>{c.channel}</td>
                    <td>
                      <button disabled={busy} onClick={() => authorize(c)}>
                        {c.authorized ? "Revoke" : "Record Authorization"}
                      </button>
                    </td>
                    <td>{c.evidence || "Missing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setContacts(null)}>
            Close Contact Review
          </button>
        </section>
      )}
      {config && (
        <form className="gn-settings" onSubmit={save}>
          <h3>Notification Settings</h3>
          <p>
            Twilio credentials remain server-side. Configure TWILIO_ACCOUNT_SID,
            TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET,
            TWILIO_MESSAGING_SERVICE_SID and TWILIO_AUTH_TOKEN privately on the
            staging API and worker in Railway. Staging always simulates SMS,
            even when credentials are configured.
          </p>
          {providerStatus && (
            <p>
              Credential setup:{" "}
              {Object.entries(providerStatus)
                .map(
                  ([key, value]) =>
                    `${key}: ${value ? "configured" : "missing"}`,
                )
                .join(" · ")}
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) =>
                setConfig({ ...config, enabled: e.target.checked })
              }
            />{" "}
            Enable Gallery SMS simulation
          </label>
          {[
            ["monthlyBudgetMicros", "Monthly budget (USD)"],
            ["galleryLimitMicros", "Per-gallery cap (USD)"],
            ["warningMicros", "Warning threshold (USD)"],
            ["baseMicros", "US base rate per segment (USD)"],
            ["carrierMicros", "US carrier fee per segment (USD)"],
            ["feeMicros", "Other known fees per segment (USD)"],
          ].map(([k, label]) => (
            <label key={k}>
              {label}
              <input
                type="number"
                min="0"
                step="0.000001"
                value={config[k] === null ? "" : config[k] / 1000000}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    [k]:
                      e.target.value === ""
                        ? null
                        : Math.round(Number(e.target.value) * 1000000),
                  })
                }
              />
            </label>
          ))}
          {[
            ["maxRecipients", "Maximum recipients"],
            ["maxSegments", "Maximum segments per message"],
          ].map(([k, label]) => (
            <label key={k}>
              {label}
              <input
                type="number"
                min="0"
                step="1"
                value={config[k]}
                onChange={(e) =>
                  setConfig({ ...config, [k]: Number(e.target.value) })
                }
              />
            </label>
          ))}
          <label>
            Rate source and date
            <input
              required
              value={config.pricingEvidence}
              onChange={(e) =>
                setConfig({ ...config, pricingEvidence: e.target.value })
              }
            />
          </label>
          <label>
            Transactional message template
            <textarea
              rows="4"
              value={config.template}
              onChange={(e) =>
                setConfig({ ...config, template: e.target.value })
              }
            />
          </label>
          <p>
            Use {"{{secure_photo_link}}"} once. Keep business identification and
            STOP/HELP instructions. Rates must include carrier and known fees.
            App limits are not a guaranteed Twilio billing cap.
          </p>
          <div className="gn-actions">
            <button type="button" onClick={() => setConfig(null)}>
              Cancel Settings
            </button>
            <button disabled={busy}>Save Settings</button>
          </div>
        </form>
      )}
      {review && (
        <dialog
          className="gn-dialog"
          ref={dialog}
          aria-labelledby="gn-review-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) decide("CANCELED");
          }}
        >
          <div className="gn-dialog-inner">
            <p className="eyebrow">GALLERY PUBLISHED</p>
            <h2 id="gn-review-title">Send Photo Links by SMS?</h2>
            <p>
              Your Gallery is published. Eligible automatic email notifications
              have been queued independently.
            </p>
            <h3>{review.eventName}</h3>
            <small>Event ID: {review.eventId}</small>
            <dl className="gn-review-grid">
              {[
                ["Imported guests", review.totalGuests],
                ["Valid mobile contacts", review.validMobile],
                ["Duplicate numbers removed", review.duplicates],
                [
                  "Consent / opt-out / access exclusions",
                  review.consentExcluded,
                ],
                ["Already notified", review.alreadyNotified],
                ["New eligible recipients", review.eligible],
                ["Rendered SMS segments", review.segments],
                [
                  "Average segments",
                  review.eligible
                    ? (review.segments / review.eligible).toFixed(2)
                    : "0",
                ],
                ["Estimated Twilio cost", money(review.estimatedMicros)],
                ["Monthly budget remaining", money(review.remainingMicros)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="gn-mode">
              Staging simulation only. Confirming records approval and exercises
              delivery without sending live SMS.
            </p>
            {review.sampleBody && <blockquote>{review.sampleBody}</blockquote>}
            {review.warning && (
              <p role="status">
                This batch meets the configured cost warning threshold. Confirm
                only after reviewing the estimate.
              </p>
            )}
            {review.reasons.length > 0 && (
              <ul>
                {review.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            <p>
              Estimate expires {new Date(review.expiresAt).toLocaleTimeString()}
              . Actual provider costs may differ. Application limits do not cap
              your Twilio bill.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="gn-actions">
              <button
                ref={cancelButton}
                disabled={busy}
                onClick={() => decide("CANCELED")}
              >
                Cancel SMS
              </button>
              <button
                className="primary-action"
                disabled={busy || !!review.reasons.length}
                onClick={() => decide("APPROVED")}
              >
                {busy ? "Please wait…" : "Confirm & Send SMS"}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}
