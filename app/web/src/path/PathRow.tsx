import { Link, useSearchParams } from "react-router";
import { isOptionalPast, type TaskView } from "@learning-tracker/core";
import { shortDate, weekdayShort } from "../today";
import { Description, TaskLinks, statusText } from "../today/TaskCard";

/** Status text on the Path screen: Today's wording plus the outline's own states (spec §7.4). */
export function pathStatus(v: TaskView, t: number, today: string): { text: string; tone?: string } {
  if (v.status !== "todo" || v.overdue) return statusText(v, t, today);
  if (isOptionalPast(v, t)) return { text: "optional · past · still tickable" };
  const multi = v.effDue > v.effDay;
  if (v.open) return { text: multi ? `open · due ${weekdayShort(v.effDueDate)}` : "today" };
  if (multi && t < v.effDay) return { text: `${v.effDue - v.effDay + 1} sessions` };
  return { text: "upcoming" };
}

/** `/today?day=<date>`, keeping the dev-only `?today=` override so the view stays put. */
export function useTodayLink(): (date: string) => string {
  const [params] = useSearchParams();
  const devToday = import.meta.env.DEV ? params.get("today") : null;
  return (date) => {
    const q = new URLSearchParams({ day: date });
    if (devToday) q.set("today", devToday);
    return `/today?${q}`;
  };
}

const CheckIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 12 12"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M2.5 6.2l2.3 2.3 4.7-5" />
  </svg>
);

interface Props {
  v: TaskView;
  t: number;
  today: string;
  expanded: boolean;
  onExpand: () => void;
  onToggleDone: () => void;
  todayLink: (date: string) => string;
}

/** One Task in the outline: check, title, kind and status, and the effective date (§7.4). */
export function PathRow({ v, t, today, expanded, onExpand, onToggleDone, todayLink }: Props) {
  const done = v.status === "done";
  const status = pathStatus(v, t, today);
  const muted = isOptionalPast(v, t);
  return (
    <li className={`prow${v.open ? " now" : ""}${muted ? " muted" : ""}`} data-task={v.task.id}>
      <button
        type="button"
        className={`check${done ? " on" : v.status === "skipped" ? " skip" : ""}`}
        aria-pressed={done}
        aria-label={`${done ? "Mark not done" : "Mark done"}: ${v.task.title}`}
        onClick={onToggleDone}
      >
        {done && <CheckIcon />}
      </button>
      <div className="prow-main">
        <button
          type="button"
          className={`title-btn${v.status !== "todo" ? " struck" : ""}`}
          aria-expanded={expanded}
          onClick={onExpand}
        >
          {v.task.title}
        </button>
        <div className="prow-sub">
          <span className="mono">
            {v.task.kind}
            {v.optional && " · optional"}
          </span>
          {status.text && (
            <span className={`mono status${status.tone ? ` status-${status.tone}` : ""}`}>
              {status.text}
            </span>
          )}
        </div>
      </div>
      <span className="prow-when mono">
        {shortDate(v.effDate)} · d{v.effDay}
      </span>
      {expanded && (
        <div className="prow-more desc">
          <p className="mono">
            authored day {v.task.day}
            {v.offsetDays !== 0 && ` · offset ${v.offsetDays > 0 ? "+" : ""}${v.offsetDays}d`}
          </p>
          <Description text={v.task.description} />
          <TaskLinks links={v.task.links} />
          <p>
            <Link className="mono" to={todayLink(v.effDate)}>
              open day {v.effDay} in Today →
            </Link>
          </p>
        </div>
      )}
    </li>
  );
}
