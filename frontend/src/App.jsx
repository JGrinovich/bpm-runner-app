import { useEffect, useState } from "react";

export default function App() {
  const [status, setStatus] = useState("checking...");
  const apiBase = import.meta.env.VITE_API_BASE_URL;

  useEffect(() => {
    fetch(`${apiBase}/healthz`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("not ok"))))
      .then((t) => setStatus(`backend: ${t}`))
      .catch(() => setStatus("backend: unavailable"));
  }, [apiBase]);

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>BPM Runner MVP</h1>
      <p>API Base URL: {apiBase}</p>
      <p>Status: {status}</p>
    </div>
  );
}
