const API_BASE = import.meta.env.VITE_API_BASE_URL;

export function getToken() {
  return localStorage.getItem("token");
}

export function setToken(token) {
  localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      (data && data.message) ||
      (typeof data === "string" && data) ||
      res.statusText;
    throw new Error(msg);
  }
  return data;
}

// Auth
export const apiSignup = (email, password) =>
  request("/api/auth/signup", { method: "POST", auth: false, body: { email, password } });

export const apiLogin = (email, password) =>
  request("/api/auth/login", { method: "POST", auth: false, body: { email, password } });

export const apiMe = () => request("/api/me");

// Tracks
export const apiListTracks = () => request("/api/tracks");
export const apiCreateTrack = (payload) =>
  request("/api/tracks", { method: "POST", body: payload });

export const apiGetTrack = (id) => request(`/api/tracks/${id}`);

// Analysis
export const apiAnalyze = (trackId) =>
  request(`/api/tracks/${trackId}/analyze`, { method: "POST" });

export const apiGetAnalysis = (trackId) =>
  request(`/api/tracks/${trackId}/analysis`);

// Render
export const apiRender = (trackId, payload) =>
  request(`/api/tracks/${trackId}/render`, { method: "POST", body: payload });

export const apiGetRender = (renderId) => request(`/api/renders/${renderId}`);
