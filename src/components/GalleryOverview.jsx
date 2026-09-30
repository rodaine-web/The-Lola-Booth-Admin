import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ImagePlus, Mail, Users } from "lucide-react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import GalleryThumbnail from "./GalleryThumbnail.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { formatTimestamp } from "../utils/display.js";
export default function GalleryOverview({ data, onTab, onAccess }) {
  const { can } = useAuth();
  const [key, setKey] = useState(null),
    [copyState, setCopyState] = useState("Copy link");
  const albumKey = data.keys.find(
    (k) => k.type === "ALBUM" && k.status === "ACTIVE",
  );
  useEffect(() => {
    setKey(null);
    if (albumKey && can("write:operations"))
      api
        .get(`/gallery-admin/keys/${albumKey.id}`)
        .then(setKey)
        .catch(() => {});
  }, [albumKey?.id]);
  return (
    <div className="gallery-overview-layout">
      <div>
        <section className="panel">
          <div className="overview-heading">
            <h2>
              Gallery Photos <span>({data.media.length})</span>
            </h2>
            <button onClick={() => onTab("Photos")}>Manage photos →</button>
          </div>
          <div className="overview-photo-grid">
            {data.media
              .filter((m) => m.status !== "ARCHIVED")
              .slice(0, 15)
              .map((m, i) => (
                <button
                  key={m.id}
                  onClick={() => onTab("Photos")}
                  aria-label={`Manage photo ${i + 1}`}
                >
                  <GalleryThumbnail id={m.id} />
                  {m.status === "HIDDEN" && <span>Hidden</span>}
                </button>
              ))}
          </div>
          {!data.media.length && (
            <div className="gallery-empty">
              <ImagePlus />
              <h2>Your event starts here.</h2>
              <p>Add photos to begin curating this private gallery.</p>
              <button
                className="primary-action"
                onClick={() => onTab("Photos")}
              >
                Upload photos
              </button>
            </div>
          )}
        </section>
        <div className="overview-bottom">
          <section className="panel">
            <div className="overview-heading">
              <h2>People / Personal Galleries</h2>
              <button onClick={() => onTab("People")}>Manage →</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Photos</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.slice(0, 5).map((p) => (
                    <tr key={p.id}>
                      <td>{p.display_name}</td>
                      <td>{p.photos}</td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.people.length && (
              <p className="note-text">
                Personal galleries only include photos you assign.
              </p>
            )}
          </section>
          <section className="panel">
            <div className="overview-heading">
              <h2>Activity</h2>
              <button onClick={() => onTab("Activity")}>View all</button>
            </div>
            {data.activity.length ? (
              data.activity.slice(0, 5).map((a) => (
                <p className="overview-activity" key={a.action}>
                  <span>{a.action.replaceAll("_", " ").toLowerCase()}</span>
                  <strong>{a.count}</strong>
                </p>
              ))
            ) : (
              <p className="note-text">
                Activity appears when guests open their private links.
              </p>
            )}
          </section>
        </div>
      </div>
      <aside>
        <section className="panel">
          <h2>Album Access (Event)</h2>
          {key ? (
            <>
              <div className="overview-access">
                <img src={key.qr} alt="Private event album QR" />
                <div>
                  <label>Event code</label>
                  <strong>{key.code}</strong>
                  <label>Event link</label>
                  <input readOnly aria-label="Event link" value={key.url} />
                </div>
              </div>
              <p className="note-text">
                Access to the approved full event gallery
              </p>
              <div className="quick-actions">
                <a
                  className="secondary-action"
                  href={key.qr}
                  download="LOLA-Album-QR.png"
                >
                  <Download size={14} />
                  Download QR
                </a>
                <button
                  className="primary-action"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(key.url);
                      setCopyState("Copied");
                    } catch {
                      setCopyState("Select link above");
                    }
                  }}
                >
                  {copyState}
                </button>
              </div>
            </>
          ) : (
            <p className="note-text">
              Create an Album QR to grant full event access.
            </p>
          )}
          <button
            className="overview-text-action"
            onClick={() => onTab("Access")}
          >
            Manage access →
          </button>
        </section>
        <section className="panel">
          <h2>Access Settings</h2>
          <dl className="overview-settings">
            <dt>Personal access expands to album</dt>
            <dd>
              <StatusBadge status="DISABLED" />
            </dd>
            <dt>Individual downloads</dt>
            <dd>
              <StatusBadge
                status={data.album.allow_download ? "ACTIVE" : "DISABLED"}
              />
            </dd>
            <dt>Personal ZIP downloads</dt>
            <dd>
              <StatusBadge
                status={data.album.allow_personal_zip ? "ACTIVE" : "DISABLED"}
              />
            </dd>
            <dt>Album expires</dt>
            <dd>
              {data.album.expires_at
                ? formatTimestamp(data.album.expires_at)
                : "No expiration set"}
            </dd>
          </dl>
          <button
            className="overview-text-action"
            onClick={() => onTab("Settings")}
          >
            Edit settings →
          </button>
        </section>
        <section className="panel">
          <h2>Quick Actions</h2>
          <div className="overview-quick">
            <button onClick={() => onTab("Photos")}>
              <ImagePlus size={16} />
              Upload more photos
            </button>
            <button onClick={() => onTab("People")}>
              <Users size={16} />
              Manage people
            </button>
            <button onClick={() => (key ? onAccess(key) : onTab("Access"))}>
              <Mail size={16} />
              Send gallery email
            </button>
            {key && (
              <a
                className="secondary-action"
                href={key.url}
                target="_blank"
                rel="noreferrer"
              >
                View gallery ↗
              </a>
            )}
            <Link to={`/events/events/${data.album.event_id}`}>
              Back to event
            </Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
