import "../styles/gallery-notifications.css";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
export default function GalleryGuestRetrieval({ albumId, canCorrect = false }) {
  const [data, setData] = useState(null),
    [selected, setSelected] = useState(null),
    [email, setEmail] = useState(""),
    [evidence, setEvidence] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const base = `/gallery-admin/albums/${albumId}/guest-retrieval`;
  useEffect(() => {
    let active = true;
    api
      .get(base)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base]);
  async function restrict(restricted) {
    setBusy(true);
    setError("");
    try {
      setData(await api.put(base + "/restriction", { restricted }));
      setNotice(
        restricted
          ? "Temporary phone retrieval is restricted; masked hints are hidden."
          : "Temporary phone retrieval enabled for this Gallery. Guest addresses remain unverified.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setData(
        await api.put(base + "/" + selected.id, { email, evidence, reviewed }),
      );
      setSelected(null);
      setEmail("");
      setEvidence("");
      setReviewed(false);
      setNotice(
        "Correction recorded. Previous retrieval links and sessions no longer grant access through this association.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel guest-notifications guest-retrieval-admin">
      <h2>Guest Retrieval Emails</h2>
      <p>
        These are guest-provided, unverified delivery addresses. They do not
        verify phone ownership, update customer identities or grant marketing
        consent.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={data.restricted !== false}
              disabled={busy || !canCorrect}
              onChange={(e) => restrict(e.target.checked)}
            />{" "}
            Restrict temporary phone retrieval and hide masked email hints
          </label>
          <p>
            Keep this enabled for sensitive or restricted Galleries. An
            authorized Admin must review the Gallery before enabling temporary
            guest retrieval. Existing photo links, email lookup and publication
            notifications retain their own permissions.
          </p>
          <div className="gn-table">
            <table>
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Email on file</th>
                  <th>Status</th>
                  <th>Identity status</th>
                  <th>Correction</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(data.addresses) ? data.addresses : []).map(
                  (a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{a.maskedEmail}</td>
                      <td>{a.status}</td>
                      <td>Guest-provided · Unverified</td>
                      <td>
                        {canCorrect && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              setSelected(a);
                              setEmail("");
                              setEvidence("");
                              setReviewed(false);
                            }}
                          >
                            Review & Correct
                          </button>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {selected && (
        <form className="gn-settings" onSubmit={save}>
          <h3>Correct Retrieval Email for {selected.name}</h3>
          <p>
            A different email submitted through public lookup cannot replace
            this address. Record your identity review before making a
            correction.
          </p>
          <label>
            Corrected retrieval email
            <input
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Identity review evidence
            <textarea
              required
              minLength={20}
              maxLength={1000}
              rows={3}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              required
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I reviewed the guest’s identity and authority for this event’s
            photos.
          </label>
          <div className="gn-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Cancel Correction
            </button>
            <button className="primary-action" disabled={busy || !reviewed}>
              Save Audited Correction
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
