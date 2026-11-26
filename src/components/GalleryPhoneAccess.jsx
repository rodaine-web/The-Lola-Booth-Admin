import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  photoRequest,
  useKeepsakesPhotos,
} from "../contexts/KeepsakesPhotos.jsx";
export function GalleryPhoneAccess({ verify = false }) {
  const [code] = useState(() =>
      new URLSearchParams(window.location.hash.slice(1)).get("code"),
    ),
    [email, setEmail] = useState(""),
    [ready, setReady] = useState(verify),
    [sent, setSent] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { accept } = useKeepsakesPhotos(),
    navigate = useNavigate();
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    if (!verify)
      photoRequest("phone/inspect", { code })
        .then(() => setReady(true))
        .catch((e) => setError(e.message));
  }, [code, verify]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (verify) {
        const data = await photoRequest("phone/verify", { code });
        accept(data.token);
        navigate("/photos/memories", { replace: true });
      } else {
        await photoRequest("phone/email", { code, email });
        setSent(true);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="shop-banner shop-information">
      <p className="shop-kicker">THE LOLA BOOTH GALLERY</p>
      <h1>
        {verify
          ? "Your memories await"
          : sent
            ? "Check your email"
            : "One step to your photos"}
      </h1>
      <p>
        {verify
          ? "Confirm this email address to open the photos shared by your secure link."
          : sent
            ? "Open the verification email within 15 minutes. No additional SMS will be sent."
            : "Verify your email before viewing the photos shared by this link."}
      </p>
      {ready && !sent && (
        <form className="shop-find-form" onSubmit={submit}>
          {!verify && (
            <label>
              Your email address
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          <button className="shop-button" disabled={busy || !code}>
            {busy
              ? "Please wait…"
              : verify
                ? "Verify Email & View Photos"
                : "Email My Verification Link"}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <p>
        This access is limited to the photos shared by this link. It does not
        establish ownership of a phone number.
      </p>
      <Link to="/find-photos">Find My Photos</Link>
    </section>
  );
}
