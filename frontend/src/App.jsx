import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { clearToken, getToken } from "./api";
import AuthPage from "./pages/AuthPage";
import LibraryPage from "./pages/LibraryPage";
import TrackPage from "./pages/TrackPage";

function Nav() {
  const nav = useNavigate();
  const authed = !!getToken();

  return (
    <div style={{ display: "flex", gap: 12, padding: 12, borderBottom: "1px solid #ddd" }}>
      <Link to="/library">Library</Link>
      <div style={{ flex: 1 }} />
      {authed ? (
        <button
          onClick={() => {
            clearToken();
            nav("/auth");
          }}
        >
          Logout
        </button>
      ) : (
        <Link to="/auth">Login</Link>
      )}
    </div>
  );
}

function RequireAuth({ children }) {
  if (!getToken()) return <Navigate to="/auth" replace />;
  return children;
}

export default function App() {
  return (
    <div style={{ fontFamily: "system-ui" }}>
      <Nav />
      <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route
            path="/library"
            element={
              <RequireAuth>
                <LibraryPage />
              </RequireAuth>
            }
          />
          <Route
            path="/tracks/:id"
            element={
              <RequireAuth>
                <TrackPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<div>Not found</div>} />
        </Routes>
      </div>
    </div>
  );
}
