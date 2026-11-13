import { useApp, useEnrollment } from "../queries";

/** Stand-in until ticket 07: proves the active Enrollment is loaded. */
export function TodayPlaceholder() {
  const app = useApp();
  const snapshot = useEnrollment(app.data?.activeEnrollmentId).data;
  return (
    <section className="hero">
      <p className="eyebrow mono">
        <span className="dot" aria-hidden="true" />
        {snapshot ? `${snapshot.path.title} · from ${snapshot.startDate}` : "loading…"}
      </p>
      <h1 className="serif">Today</h1>
    </section>
  );
}
