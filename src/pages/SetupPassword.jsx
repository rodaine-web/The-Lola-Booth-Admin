import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";

export default function SetupPassword() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    if (!token) return setError("This setup link is missing its token.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    setSubmitting(true);
    try {
      await api.setupPassword({ token, password });
      setStatus("Password set. You can now sign in.");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand large login-brand">
          <img className="brand-logo brand-logo-primary" src="/brand/LOLA_Primary_Dark_Transparent.png" alt="The LOLA Booth" />
          <div>
            <strong>Admin Portal</strong>
            <span>Secure account setup</span>
          </div>
        </div>
        <form onSubmit={onSubmit}>
          <label>New password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" /></label>
          <label>Confirm password<input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" /></label>
          {error && <p className="form-error">{error}</p>}
          {status && <p className="form-success">{status}</p>}
          <button className="primary-action" disabled={submitting || !token}>{submitting ? "Setting password..." : "Set password"}</button>
          <Link className="subtle-link" to="/login">Back to sign in</Link>
        </form>
      </section>
    </main>
  );
}
