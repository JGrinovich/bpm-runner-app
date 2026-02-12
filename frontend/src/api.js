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

/**
 * =========================
 * Phase B: Signed uploads
 * =========================
 */

// 1) Ask backend for signed PUT URL + object key
export async function apiGetSignedUploadUrl({ filename, mime_type }) {
  return request("/api/uploads/signed-url", {
    method: "POST",
    body: { filename, mime_type },
    auth: true,
  }); // returns { object_key, signed_put_url }
}

// 2) Upload file directly to R2 via signed PUT URL
export async function putToSignedUrl(signedPutUrl, file) {
  const res = await fetch(signedPutUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
}

// 3) Convenience helper: full upload flow -> returns created track {id: ...}
export async function apiUploadTrackViaSignedUrl(file, { title = "" } = {}) {
  // Step 1: signed URL
  const { object_key, signed_put_url } = await apiGetSignedUploadUrl({
    filename: file.name,
    mime_type: file.type,
  });

  // Step 2: direct PUT to R2
  await putToSignedUrl(signed_put_url, file);

  // Step 3: create track row in DB
  return apiCreateTrack({
    title,
    source_filename: file.name,
    mime_type: file.type,
    original_object_key: object_key,
  });
}
