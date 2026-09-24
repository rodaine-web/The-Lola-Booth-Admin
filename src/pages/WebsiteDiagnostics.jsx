import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function WebsiteDiagnostics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  async function load() { setError(""); try { setData(await api.get("/website/diagnostics")); } catch (err) { setError(err.message); } }
  useEffect(() => { load(); }, []);
  return <main className="page"><div className="page-heading"><div><p className="eyebrow">Website</p><h1>CMS connection</h1><p>Published content available to the public website.</p></div><button onClick={load}>Refresh status</button></div>
    {error && <div role="alert" className="toast error">{error}</div>}
    {data && <><section className="panel"><h2>Connection status</h2><p>API reachable · CMS reachable · Homepage {data.homepageLoaded ? "loaded" : "empty"}</p><p>Checked {new Date(data.checkedAt).toLocaleString()}</p><p>Last successful import: {data.last_import_at ? new Date(data.last_import_at).toLocaleString() : "No recorded import"} · {data.mapped_records} mapped records</p></section><section className="panel"><h2>Published records</h2><table><thead><tr><th>Content</th><th>Count</th></tr></thead><tbody>{Object.entries(data.counts).map(([name,count]) => <tr key={name}><td>{name.replace(/([A-Z])/g," $1")}</td><td>{count}</td></tr>)}</tbody></table></section></>}
  </main>;
}
