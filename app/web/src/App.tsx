import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { PickEnrollment } from "./enroll/Switcher";
import { StartPage } from "./enroll/StartPage";
import { Header } from "./Header";
import { useApp, useEnrollments } from "./queries";
import { NotesScreen } from "./notes/NotesScreen";
import { PathScreen } from "./path/PathScreen";
import { ToastProvider } from "./toast";
import { TodayScreen } from "./today/TodayScreen";

/**
 * Landing logic (spec §7.2): with an active Enrollment, show the screen; with none, the switcher
 * when Enrollments exist, else the empty state.
 */
function RequireActive({ children }: { children: ReactNode }) {
  const app = useApp();
  const list = useEnrollments();
  if (app.isError || list.isError) return <p className="error">Couldn&apos;t reach the server.</p>;
  if (!app.data || !list.data) return <p className="mono loading">loading…</p>;
  if (app.data.activeEnrollmentId) return children;
  return list.data.length > 0 ? <PickEnrollment /> : <StartPage firstRun />;
}

export function App() {
  return (
    <ToastProvider>
      <Header />
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route
            path="/today"
            element={
              <RequireActive>
                <TodayScreen />
              </RequireActive>
            }
          />
          <Route
            path="/path"
            element={
              <RequireActive>
                <PathScreen />
              </RequireActive>
            }
          />
          <Route
            path="/notes"
            element={
              <RequireActive>
                <NotesScreen />
              </RequireActive>
            }
          />
          <Route path="/new" element={<StartPage firstRun={false} />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
    </ToastProvider>
  );
}
