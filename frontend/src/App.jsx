import { Routes, Route, Navigate } from "react-router-dom";
import { getToken } from "./api";
import AuthPage from "./pages/AuthPage";
import LibraryPage from "./pages/LibraryPage";
import TrackPage from "./pages/TrackPage";
import { AppLayout } from "@/components/layout/AppLayout";

function RequireAuth({ children }) {
  if (!getToken()) return <Navigate to="/auth" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/library" replace />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="tracks/:id" element={<TrackPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
