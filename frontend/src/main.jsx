import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";

// Vite sets BASE_URL from vite.config "base":
// - dev: "/"
// - prod (GitHub Pages project): "/bpm-runner-app/"
const baseUrl = import.meta.env.BASE_URL;
const routerBasename = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

// SPA redirect (404.html) passes the original path via ?p=...
const params = new URLSearchParams(window.location.search);
const p = params.get("p");
if (p) {
  window.history.replaceState(null, "", `${routerBasename}/${decodeURIComponent(p)}`);
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
