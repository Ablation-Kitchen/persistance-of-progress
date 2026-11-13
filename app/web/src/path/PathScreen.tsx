import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import {
  currentBlockIndex,
  pathOutline,
  runInfo,
  stats,
  type OutlineBlock,
  type Shift,
  type Snapshot,
  type TaskView,
} from "@learning-tracker/core";
import { useApp, useEnrollment, useSetTaskState } from "../queries";
import { shortDate, useToday } from "../today";
import { useNotes } from "../notes/api";
import { ResourceIndex } from "./ResourceIndex";
import { PathRow, useTodayLink } from "./PathRow";

export const FILTERS = ["all", "open", "overdue", "optional", "done"] as const;
export type Filter = (typeof FILTERS)[number];

/** `open` is §5's open (todo inside its window); `optional` is every optional Task. */
const passes: Record<Filter, (v: TaskView) => boolean> = {
  all: () => true,
  open: (v) => v.open,
  overdue: (v) => v.overdue,
  optional: (v) => v.optional,
  done: (v) => v.status === "done",
};

/** `7 sep` from `mon 7 sep`. */
const dayMonth = (date: string) => shortDate(date).slice(4);
const pad2 = (n: number) => String(n).padStart(2, "0");

/** The Path screen for the active Enrollment (spec §7.4). */
export function PathScreen() {
  const app = useApp();
  const query = useEnrollment(app.data?.activeEnrollmentId);
  if (query.isError) return <p className="error">Couldn&apos;t load the enrollment.</p>;
  if (!query.data) return <p className="mono loading">loading…</p>;
  return <PathView snapshot={query.data} />;
}

function PathView({ snapshot }: { snapshot: Snapshot }) {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const raw = params.get("filter");
  const filter: Filter = (FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as Filter)
    : "all";
  const setFilter = (f: Filter) =>
    setParams(
      (p) => {
        if (f === "all") p.delete("filter");
        else p.set("filter", f);
        return p;
      },
      { replace: true },
    );

  const [openBlocks, setOpenBlocks] = useState<ReadonlySet<number>>(
    () => new Set([currentBlockIndex(snapshot, today)]),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // A Resource Index chip opens its Task: its Block open, the filter off, the row expanded,
  // then scrolled into view once that render has committed.
  const jumpTarget = useRef<string | null>(null);
  useEffect(() => {
    const id = jumpTarget.current;
    if (!id) return;
    jumpTarget.current = null;
    document.querySelector(`.prow[data-task="${id}"]`)?.scrollIntoView?.({
      behavior: "smooth",
      block: "center",
    });
  });
  const setState = useSetTaskState(snapshot.id).mutate;
  const todayLink = useTodayLink();

  const run = runInfo(snapshot, today);
  const t = run.day;
  const s = stats(snapshot, today);
  const outline = pathOutline(snapshot, today);

  const eyebrow = run.beforeStart
    ? `starts ${shortDate(snapshot.startDate)} · in ${1 - t} day${1 - t === 1 ? "" : "s"}`
    : run.finished
      ? `path finished · ${shortDate(today)}`
      : `day ${t} of ${run.length} · week ${run.week} of ${run.weeks} · ${shortDate(today)}`;

  const toggleIn = <T,>(set: ReadonlySet<T>, x: T) => {
    const next = new Set(set);
    if (!next.delete(x)) next.add(x);
    return next;
  };

  const jumpTo = (taskId: string) => {
    const blockIndex = outline.find((b) =>
      b.weeks.some((w) => w.tasks.some((v) => v.task.id === taskId)),
    )?.blockIndex;
    if (blockIndex !== undefined) setOpenBlocks((o) => new Set(o).add(blockIndex));
    setFilter("all");
    setExpanded((e) => new Set(e).add(taskId));
    jumpTarget.current = taskId;
  };

  const row = (v: TaskView) => (
    <PathRow
      key={v.task.id}
      v={v}
      t={t}
      today={today}
      expanded={expanded.has(v.task.id)}
      onExpand={() => setExpanded((e) => toggleIn(e, v.task.id))}
      onToggleDone={() =>
        setState({
          taskId: v.task.id,
          status: v.status === "done" ? "todo" : "done",
          statusDate: today,
        })
      }
      todayLink={todayLink}
    />
  );

  const percent = s.percent === null ? "—" : `${s.percent}%`;
  const statList = [
    ["required done", percent],
    ["checkpoints passed", `${s.checkpointsPassed}/${s.checkpoints}`],
    ["blocks complete", `${s.blocksComplete}/${snapshot.path.blocks.length}`],
    ["day streak", String(s.streak)],
  ];

  return (
    <div className="path-screen">
      <section className="hero path-hero">
        <div>
          <p className="eyebrow mono">
            <span className="dot pulse" aria-hidden="true" />
            {eyebrow}
          </p>
          <h1 className="serif">
            The <em>path</em>.
          </h1>
          <p className="goal">{snapshot.path.title}</p>
        </div>
        <dl className="stats path-stats">
          {statList.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="path-layout">
        <div className="path-main">
          <div className="path-controls">
            <div className="chips" role="group" aria-label="Filter tasks">
              {FILTERS.map((f) => (
                <button
                  type="button"
                  key={f}
                  className={`pill sm${filter === f ? " on" : ""}`}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="chips">
              <button
                type="button"
                className="pill sm ghost"
                onClick={() => setOpenBlocks(new Set(outline.map((b) => b.blockIndex)))}
              >
                expand all
              </button>
              <button
                type="button"
                className="pill sm ghost"
                onClick={() => setOpenBlocks(new Set())}
              >
                collapse
              </button>
            </div>
          </div>

          {outline.map((b) => (
            <BlockSection
              key={b.blockIndex}
              snapshot={snapshot}
              b={b}
              open={openBlocks.has(b.blockIndex)}
              onToggle={() => setOpenBlocks((o) => toggleIn(o, b.blockIndex))}
              filter={filter}
              row={row}
            />
          ))}

          <Removed snapshot={snapshot} />
        </div>
        <aside className="path-side" aria-label="Resource index">
          <ResourceIndex snapshot={snapshot} today={today} onJump={jumpTo} />
        </aside>
      </div>
    </div>
  );
}

function BlockSection({
  snapshot,
  b,
  open,
  onToggle,
  filter,
  row,
}: {
  snapshot: Snapshot;
  b: OutlineBlock;
  open: boolean;
  onToggle: () => void;
  filter: Filter;
  row: (v: TaskView) => ReactNode;
}) {
  const block = snapshot.path.blocks[b.blockIndex]!;
  const sig = b.signals;
  const bodyId = `block-${b.blockIndex}`;
  const pct = sig.required ? (100 * sig.requiredDone) / sig.required : 0;
  const weeks = b.weeks
    .map((w) => ({ ...w, shown: w.tasks.filter(passes[filter]) }))
    .filter((w) => w.shown.length > 0 || w.shifts.length > 0);

  return (
    <section
      className={`blk card state-${sig.state}`}
      aria-label={`Block ${b.blockIndex + 1}: ${block.title}`}
      data-state={sig.state}
    >
      <button
        type="button"
        className="blk-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="blk-num">{pad2(b.blockIndex + 1)}</span>
        <span className="blk-title">{block.title}</span>
        <span className="mono" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
        <span className="blk-meta">
          <span className={`bar${sig.complete ? " donebar" : ""}`} aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="mono blk-done">
            {sig.requiredDone}/{sig.required} required
          </span>
          <span className="mono">
            checkpoints {sig.checkpointsPassed}/{sig.checkpoints}
          </span>
          {sig.bonus > 0 && <span className="mono">+{sig.bonus} bonus</span>}
          {sig.overdue > 0 && <span className="mono status-over">{sig.overdue} overdue</span>}
          <span className="mono">
            {dayMonth(sig.firstDate)} – {dayMonth(sig.lastDate)}
          </span>
          <span className={`tag state-tag ${sig.state}`}>{sig.state}</span>
        </span>
      </button>
      {open && (
        <div className="blk-body" id={bodyId}>
          <p className="blk-goal">{block.goal}</p>
          {weeks.length === 0 && <p className="mono empty">no tasks match “{filter}”</p>}
          {weeks.map((w) => (
            <div className="wk" key={w.week} aria-label={`Week ${w.week}`} role="group">
              <div className="wk-h">
                <span className="serif">Week {w.week}</span>
                <span className="mono">
                  {dayMonth(w.firstDate)} – {dayMonth(w.lastDate)}
                </span>
                {w.thisWeek && <span className="tag this-week">this week</span>}
                {w.movedBy.length > 0 && (
                  <span className="mono status-over moved">
                    moved {w.movedBy.map((d) => `+${d}d`).join(" / ")} by a shift
                  </span>
                )}
              </div>
              {w.shifts.map((sh) => (
                <ShiftMarker key={sh.id} shift={sh} />
              ))}
              {w.shown.length > 0 && <ul className="prows">{w.shown.map(row)}</ul>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ShiftMarker({ shift }: { shift: Shift }) {
  const n = shift.taskIds.length;
  return (
    <p className="shiftmark mono">
      <span className="dot" aria-hidden="true" />
      shifted +{shift.days}d on {shortDate(shift.appliedOn)} · {n} open task{n === 1 ? "" : "s"}{" "}
      moved
    </p>
  );
}

/** Tombstoned Tasks: kind, former day, frozen status and a Note excerpt (spec §7.4). */
function Removed({ snapshot }: { snapshot: Snapshot }) {
  const withNote = new Set(snapshot.noteMeta.map((n) => n.target));
  const anyNote = snapshot.tombstones.some((x) => withNote.has(`task:${x.taskId}`));
  const bodies = useNotes(anyNote ? snapshot.id : null).data;
  if (snapshot.tombstones.length === 0) return null;
  const states = new Map(snapshot.taskStates.map((r) => [r.taskId, r]));
  const n = snapshot.tombstones.length;

  return (
    <section className="blk card removed" aria-label="Removed from the path">
      <div className="blk-body">
        <div className="wk-h">
          <span className="serif">Removed from the path</span>
          <span className="mono">
            {n} task{n === 1 ? "" : "s"} · kept because they have progress or a note ·{" "}
            <Link to="/notes?block=removed">all their notes →</Link>
          </span>
        </div>
        <ul className="prows">
          {snapshot.tombstones.map((x) => {
            const target = `task:${x.taskId}`;
            const status = states.get(x.taskId)?.status ?? "todo";
            const body = bodies?.find((b) => b.target === target)?.body;
            const excerpt = body === undefined ? null : body.replace(/\s+/g, " ").trim();
            return (
              <li className="prow muted" key={x.taskId} data-task={x.taskId}>
                <span
                  className={`check${status === "done" ? " on" : status === "skipped" ? " skip" : ""}`}
                  aria-hidden="true"
                />
                <div className="prow-main">
                  <span className="t">{x.title}</span>
                  <div className="prow-sub">
                    <span className="mono">
                      {x.kind} · was d{x.formerDay} · {status}
                    </span>
                    {withNote.has(target) && (
                      <span className="mono note-excerpt">
                        {excerpt === null
                          ? "has a note"
                          : `note: “${excerpt.slice(0, 60)}${excerpt.length > 60 ? "…" : ""}”`}
                      </span>
                    )}
                  </div>
                </div>
                <Link
                  className="prow-when mono"
                  to={`/notes?block=removed&note=${encodeURIComponent(target)}`}
                >
                  open note →
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
