import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { stats, type EnrollmentSummary } from "@learning-tracker/core";
import {
  useApp,
  useDeleteEnrollment,
  useEnrollment,
  useEnrollments,
  useSetActive,
} from "../queries";
import { useToday } from "../today";

/** Each Enrollment with title, start date and Task count; the active one adds percent and streak. */
export function EnrollmentList({ onDone }: { onDone?: () => void }) {
  const app = useApp();
  const list = useEnrollments();
  const activeId = app.data?.activeEnrollmentId ?? null;
  const setActive = useSetActive();
  const navigate = useNavigate();

  if (!list.data) return <p className="mono">loading…</p>;
  return (
    <ul className="enrollments">
      {list.data.map((e) => (
        <EnrollmentRow
          key={e.id}
          e={e}
          active={e.id === activeId}
          onPick={() =>
            setActive.mutate(e.id, {
              onSuccess: () => {
                onDone?.();
                void navigate("/today");
              },
            })
          }
        />
      ))}
    </ul>
  );
}

function EnrollmentRow({
  e,
  active,
  onPick,
}: {
  e: EnrollmentSummary;
  active: boolean;
  onPick: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteEnrollment();
  return (
    <li className={`enrollment${active ? " active" : ""}`}>
      <button type="button" className="pick" onClick={onPick} aria-current={active || undefined}>
        <span className="path-title">{e.title}</span>
        <span className="mono">
          from {e.startDate} · {e.taskCount} tasks
          {active && <ActiveStats id={e.id} />}
        </span>
      </button>
      {confirming ? (
        <span className="row" role="group" aria-label={`Delete ${e.title}?`}>
          <span className="mono">delete with all progress and notes?</span>
          <button
            type="button"
            className="pill sm danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate(e.id)}
          >
            Delete
          </button>
          <button type="button" className="pill sm" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="pill sm ghost"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${e.title}`}
        >
          Delete
        </button>
      )}
    </li>
  );
}

function ActiveStats({ id }: { id: string }) {
  const snapshot = useEnrollment(id).data;
  const today = useToday();
  if (!snapshot) return null;
  const s = stats(snapshot, today);
  return (
    <>
      {" · "}
      {s.percent === null ? "—" : `${s.percent}%`} · {s.streak}-day streak
    </>
  );
}

/** The Enrollment switcher in the app menu. */
export function SwitcherMenu() {
  const app = useApp();
  const active = useEnrollment(app.data?.activeEnrollmentId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="pill sm"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        {active.data?.path.title ?? "Enrollments"} ▾
      </button>
      {open && (
        <div className="menu-pop card" role="menu">
          <p className="mono">enrollments</p>
          <EnrollmentList onDone={() => setOpen(false)} />
          <button
            type="button"
            className="pill sm"
            onClick={() => {
              setOpen(false);
              void navigate("/new");
            }}
          >
            New enrollment
          </button>
        </div>
      )}
    </div>
  );
}

/** Landing when no Enrollment is active but some exist. */
export function PickEnrollment() {
  const navigate = useNavigate();
  return (
    <>
      <section className="hero">
        <p className="eyebrow mono">
          <span className="dot" aria-hidden="true" /> no active enrollment
        </p>
        <h1 className="serif">Pick an enrollment.</h1>
      </section>
      <EnrollmentList />
      <p>
        <button type="button" className="pill" onClick={() => void navigate("/new")}>
          New enrollment
        </button>
      </p>
    </>
  );
}
