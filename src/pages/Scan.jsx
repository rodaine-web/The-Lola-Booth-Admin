import { Camera, RotateCcw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";

export default function Scan() {
  const [searchParams] = useSearchParams();
  const params = useParams();
  const eventId = searchParams.get("eventId");
  const [token, setToken] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [scannerState, setScannerState] = useState("CAMERA READY");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const scanningRef = useRef(false);

  useEffect(() => {
    if (!window.BarcodeDetector) setScannerState("CAMERA UNSUPPORTED");
    else if (!navigator.mediaDevices?.getUserMedia) setScannerState("CAMERA UNSUPPORTED");
    if (params.token) {
      setToken(params.token);
      lookup(params.token);
    }
    return stopCamera;
  }, []);

  async function lookup(value = token) {
    setError("");
    setResult(null);
    try {
      const suffix = eventId ? `?eventId=${eventId}` : "";
      const response = await api.get(`/scan/equipment/${encodeURIComponent(value)}${suffix}`);
      setResult(response);
      setScannerState(response.warning ? "WRONG EVENT" : "FOUND");
    } catch (err) {
      setError(err.message);
      setScannerState(err.message?.toLowerCase().includes("already") ? "ALREADY PROCESSED" : err.message?.toLowerCase().includes("assigned to this event") ? "WRONG EVENT" : "NOT FOUND");
    }
  }

  async function startCamera() {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setScannerState("CAMERA UNSUPPORTED");
      return;
    }
    setError("");
    try {
      detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      videoRef.current.srcObject = streamRef.current;
      await videoRef.current.play();
      scanningRef.current = true;
      setScannerState("SCANNING");
      scanFrame();
    } catch (err) {
      setError(err.message);
      setScannerState("CAMERA DENIED");
      stopCamera();
    }
  }

  async function scanFrame() {
    if (!scanningRef.current || !detectorRef.current || !videoRef.current) return;
    try {
      const codes = await detectorRef.current.detect(videoRef.current);
      const value = codes[0]?.rawValue;
      if (value) {
        stopCamera();
        const parsed = value.split("/scan/equipment/").pop()?.split("?")[0] || value;
        setToken(decodeURIComponent(parsed));
        await lookup(decodeURIComponent(parsed));
        return;
      }
    } catch {
      setScannerState("NOT FOUND");
    }
    requestAnimationFrame(scanFrame);
  }

  function stopCamera() {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  return (
    <main className="attendant-shell">
      <header className="attendant-header">
        <img src="/brand/LOLA_Primary_Dark_Transparent.png" alt="The LOLA Booth" />
        <span>Equipment Scan</span>
      </header>
      <section className="attendant-hero">
        <p className="eyebrow">QR Equipment</p>
        <h1>Scan</h1>
        <p>{scannerState}</p>
      </section>
      <section className="attendant-section">
        <h2>Lookup</h2>
        <div className={`scanner-frame ${scannerState.toLowerCase().replaceAll(" ", "-")}`}>
          <video ref={videoRef} playsInline muted />
          <span>{scannerState}</span>
        </div>
        <div className="button-row">
          <button className="primary-action" onClick={startCamera} disabled={scannerState === "SCANNING"}><Camera size={16} />Scan QR</button>
          <button onClick={() => { stopCamera(); setResult(null); setError(""); setScannerState(window.BarcodeDetector ? "CAMERA READY" : "CAMERA UNSUPPORTED"); }}><RotateCcw size={16} />Try Again</button>
        </div>
        <div className="inline-form note-form">
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Asset UID or QR token" />
          <button className="primary-action" disabled={!token.trim()} onClick={() => lookup()}><Search size={16} />Search</button>
        </div>
        {error && <div className="toast error">{error}</div>}
      </section>
      {result && (
        <section className="attendant-section">
          <h2>{result.equipment.name}</h2>
          {result.warning && <div className="toast error">{result.warning}</div>}
          <Row label="Asset UID" value={result.equipment.asset_uid || result.equipment.equipment_id} />
          <Row label="Category" value={result.equipment.category} />
          <Row label="Current Status" value={result.equipment.status} />
          <Row label="Event" value={result.equipment.event_name} />
          <Row label="Lifecycle" value={result.equipment.lifecycle_status} />
          <Row label="Condition" value={result.equipment.condition_after || result.equipment.condition_before} />
        </section>
      )}
    </main>
  );
}

function Row({ label, value }) { return <div className="field-row"><span>{label}</span><strong>{value || "—"}</strong></div>; }
