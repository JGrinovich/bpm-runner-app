import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";

const params = new URLSearchParams(window.location.search);
const p = params.get("p");
if (p) {
  window.history.replaceState(null, "", "/bpm-runner-app/" + decodeURIComponent(p));
}


ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename="/bpm-runner-app">
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
