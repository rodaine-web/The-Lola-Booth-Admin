import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import RelationshipSelect from "./RelationshipSelect.jsx";
import StatusBadge from "./StatusBadge.jsx";
export default function GalleryImports() {
  const [rows, setRows] = useState([]),
    [event, setEvent] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api.get("/gallery-admin/imports").then((r) => setRows(r.data));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function act(row, ignore) {
    setBusy(true);
    setError("");
    try {
      if (ignore) await api.post(`/gallery-admin/imports/${row.id}/ignore`, {});
      else {
        const album = await api.post("/gallery-admin/albums", {
          event_id: event,
        });
        await api.post(`/gallery-admin/imports/${row.id}/match`, {
          album_id: album.id,
        });
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel gallery-imports">
      <h2>Unmatched imports</h2>
      <p>
        Incoming captures stay private until matched to an event. Ignoring an
        import retains its file.
      </p>
      {error && <p role="alert">{error}</p>}
      <RelationshipSelect resource="events" value={event} onChange={setEvent} />
      <Link to="/events/events">Create an event →</Link>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>External event</th>
              <th>File</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.source_provider}</td>
                <td>{r.external_event_id}</td>
                <td>{r.filename}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>
                  {r.status !== "MATCHED" && (
                    <div className="quick-actions">
                      <button
                        disabled={!event || busy}
                        onClick={() => act(r, false)}
                      >
                        Match to selected event
                      </button>
                      {r.status === "UNMATCHED" && (
                        <button disabled={busy} onClick={() => act(r, true)}>
                          Ignore
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="note-text">
          No incoming captures. Provider adapters can use the authenticated
          import endpoint when connected.
        </p>
      )}
    </section>
  );
}
