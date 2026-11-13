import type { Link, TaskView } from "@learning-tracker/core";
import { shortDate, weekdayShort } from "../today";

export interface TaskActions {
  /** Done ↔ not done. A tick records `today` as the status date. */
  toggleDone: (v: TaskView) => void;
  skip: (v: TaskView) => void;
  unskip: (v: TaskView) => void;
  select: (v: TaskView) => void;
}

/** "2d overdue", "day 2 of 4 · due fri", "done today", … (spec §7.3). */
export function statusText(v: TaskView, t: number, today: string): { text: string; tone?: string } {
  if (v.status === "done") {
    const when = v.statusDate === today ? "today" : v.statusDate ? shortDate(v.statusDate) : "";
    return { text: `done ${when}${v.doneLate ? " · late" : ""}`.trim(), tone: "ok" };
  }
  if (v.status === "skipped") return { text: "skipped" };
  if (v.overdue) return { text: `${v.daysOverdue}d overdue`, tone: "over" };
  const sessions = v.effDue - v.effDay + 1;
  if (sessions > 1) {
    const due = `due ${weekdayShort(v.effDueDate)}`;
    if (v.open) return { text: `day ${t - v.effDay + 1} of ${sessions} · ${due}` };
    if (t < v.effDay) return { text: `${sessions} sessions · ${due}` };
  }
  return { text: "" };
}

export function KindLabel({ v }: { v: TaskView }) {
  return (
    <span className="kind mono">
      {v.task.kind}
      {v.optional && " · optional"}
    </span>
  );
}

export function TaskLinks({ links }: { links: Link[] | undefined }) {
  if (!links?.length) return null;
  return (
    <ul className="links">
      {links.map((l, i) => (
        <li key={i}>
          {l.url ? (
            <a href={l.url} target="_blank" rel="noopener noreferrer">
              {l.title} ↗
            </a>
          ) : (
            <span className="mono">book · {l.title}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A Task description as plain paragraphs. Markdown rendering arrives with `<NoteView>` (08). */
export function Description({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <div className="prose">
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

const CheckIcon = () => (
  <svg
    width="12"
    height="12"
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
  selected: boolean;
  expanded: boolean;
  onExpand: () => void;
  actions: TaskActions;
}

export function TaskCard({ v, t, today, selected, expanded, onExpand, actions }: Props) {
  const done = v.status === "done";
  const status = statusText(v, t, today);
  const hasMore = !!v.task.description || !!v.task.links?.length;
  return (
    <article className={`task card${selected ? " sel" : ""}`} data-task={v.task.id}>
      <div className="card-top">
        <KindLabel v={v} />
        {v.overdue && <span className="dot" aria-label="overdue" />}
      </div>
      <div className="card-main">
        <button
          type="button"
          className={`check${done ? " on" : ""}`}
          aria-pressed={done}
          aria-label={`${done ? "Mark not done" : "Mark done"}: ${v.task.title}`}
          onClick={() => actions.toggleDone(v)}
        >
          {done && <CheckIcon />}
        </button>
        <button
          type="button"
          className={`title-btn${v.status !== "todo" ? " struck" : ""}`}
          aria-pressed={selected}
          onClick={() => actions.select(v)}
        >
          {v.task.title}
        </button>
      </div>
      <div className="card-foot">
        {status.text && (
          <span className={`mono${status.tone ? ` status-${status.tone}` : ""}`}>
            {status.text}
          </span>
        )}
        {hasMore && (
          <button type="button" className="linkbtn" aria-expanded={expanded} onClick={onExpand}>
            {expanded ? "less −" : "more +"}
          </button>
        )}
        {v.status === "todo" && (
          <button type="button" className="linkbtn" onClick={() => actions.skip(v)}>
            skip
          </button>
        )}
        {v.status === "skipped" && (
          <button type="button" className="linkbtn" onClick={() => actions.unskip(v)}>
            unskip
          </button>
        )}
      </div>
      {expanded && (
        <div className="desc">
          <Description text={v.task.description} />
          <TaskLinks links={v.task.links} />
        </div>
      )}
    </article>
  );
}
