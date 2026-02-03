import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiLogin, apiSignup, setToken } from "../api";

export default function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("password123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res =
        mode === "signup"
          ? await apiSignup(email, password)
          : await apiLogin(email, password);
      setToken(res.token);
      nav("/library");
    } catch (e) {
      setErr(e.message || "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>{mode === "signup" ? "Sign up" : "Login"}</h2>

      <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 420 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          type="password"
        />
        <button disabled={busy}>{busy ? "Working..." : "Continue"}</button>
      </form>

      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <p style={{ marginTop: 12 }}>
        {mode === "signup" ? "Already have an account?" : "Need an account?"}{" "}
        <button onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          Switch to {mode === "signup" ? "login" : "signup"}
        </button>
      </p>

      <p style={{ color: "#666" }}>
        MVP note: password must be 8+ chars (per backend validation).
      </p>
    </div>
  );
}
