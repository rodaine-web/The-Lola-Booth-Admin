import { AlertTriangle, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function SystemHealth() {
  const [health, setHealth] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [healthResult, jobsResult] = await Promise.all([api.get("/system/health"), api.get("/system/jobs")]);
      setHealth(healthResult);
      setJobs(jobsResult.data || []);
      setSelected([]);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function jobAction(id, action) {
    await api.post(`/system/jobs/${id}/${action}`, {});
    await load();
  }

  async function retrySelected() {
    await api.post("/system/jobs/retry-selected", { ids: selected });
    await load();
  }

  function toggleJob(id, checked) {
    setSelected((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  }

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Production readiness</p>
          <h1>System Health</h1>
        </div>
        <button className="primary-action" onClick={load}><RefreshCw size={16} />Refresh</button>
      </div>
      {error && <div className="toast error">{error}</div>}
      {health && <section className={`health-banner ${health.status.toLowerCase()}`}>
        <AlertTriangle size={18} />
        <div><strong>{health.status}</strong><span>Generated {new Date(health.generatedAt).toLocaleString()}</span></div>
      </section>}
      <section className="health-grid">
        {(health?.checks || []).map((item) => (
          <article className={`health-card ${item.status.toLowerCase()}`} key={item.name}>
            <small>{item.status}</small>
            <strong>{item.name.replaceAll(".", " ")}</strong>
            <p>{item.summary}</p>
          </article>
        ))}
      </section>
      <section className="panel">
        <div className="table-heading">
          <h2>Automation Jobs</h2>
          <div className="button-row">
            <span className="note-text">Worker command: npm run worker</span>
            <button className="table-action" disabled={!selected.length} onClick={retrySelected}><RotateCcw size={14} />Retry Selected</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Select</th><th>Job</th><th>Status</th><th>Scheduled</th><th>Attempts</th><th>Error</th><th>Actions</th></tr></thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td><input type="checkbox" disabled={!["FAILED", "CANCELLED"].includes(job.status)} checked={selected.includes(job.id)} onChange={(event) => toggleJob(job.id, event.target.checked)} /></td>
                  <td>{job.automation_name || job.job_type}</td>
                  <td>{job.status}</td>
                  <td>{job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : "—"}</td>
                  <td>{job.attempt_count}/{job.max_attempts}</td>
                  <td>{job.last_error || "—"}</td>
                  <td className="button-row">
                    {["FAILED", "CANCELLED"].includes(job.status) && <button className="table-action" onClick={() => jobAction(job.id, "retry")}><RotateCcw size={14} />Retry</button>}
                    {["PENDING", "PROCESSING"].includes(job.status) && <button className="table-action" onClick={() => jobAction(job.id, "cancel")}><XCircle size={14} />Cancel</button>}
                  </td>
                </tr>
              ))}
              {!jobs.length && <tr><td colSpan="7">No automation jobs.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
