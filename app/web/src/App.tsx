import { Navigate, Route, Routes } from "react-router";
import { Header } from "./Header";
import { Placeholder } from "./routes/Placeholder";

export function App() {
  return (
    <>
      <Header />
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<Placeholder title="Today" />} />
          <Route path="/path" element={<Placeholder title="Path" />} />
          <Route path="/notes" element={<Placeholder title="Notes" />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
    </>
  );
}
