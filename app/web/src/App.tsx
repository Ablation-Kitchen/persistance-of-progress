import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { PickEnrollment } from "./enroll/Switcher";
import { StartPage } from "./enroll/StartPage";
import { Header } from "./Header";
import { useApp, useEnrollments } from "./queries";
import { Placeholder } from "./routes/Placeholder";
import { TodayPlaceholder } from "./routes/TodayPlaceholder";

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
    <>
      <Header />
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route
            path="/today"
            element={
              <RequireActive>
                <TodayPlaceholder />
              </RequireActive>
            }
          />
          <Route
            path="/path"
            element={
              <RequireActive>
                <Placeholder title="Path" />
              </RequireActive>
            }
          />
          <Route
            path="/notes"
            element={
              <RequireActive>
                <Placeholder title="Notes" />
              </RequireActive>
            }
          />
          <Route path="/new" element={<StartPage firstRun={false} />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
    </>
  );
}
