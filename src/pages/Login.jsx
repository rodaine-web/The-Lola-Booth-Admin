import EnvironmentBadge from "../components/EnvironmentBadge.jsx";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api/client.js";

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [setup, setSetup] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get("/setup/status").then(setSetup).catch(() => null);
  }, []);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login({ email, password });
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
            <strong>Admin Portal</strong><EnvironmentBadge/>
            <span>Luxury event operations</span>
          </div>
        </div>
        <form onSubmit={onSubmit}>
          <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" /></label>
          <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" /></label>
          {error && <p className="form-error">{error}</p>}
          {setup?.ready === false && (
            <div className="setup-alert">
              <strong>Database setup needed</strong>
              <span>{setup.message}</span>
              {setup.steps?.map((step) => <code key={step}>{step}</code>)}
            </div>
          )}
          <button className="primary-action" disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}
