import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  blockSignals,
  currentBlockIndex,
  dateOfDay,
  dayNumber,
  isDate,
  pathWeek,
  rhythmLabel,
  runInfo,
  stats,
  taskViews,
  tasksOnDay,
  todayColumns,
  weekStrip,
  type Snapshot,
  type TaskView,
} from "@learning-tracker/core";
import { useApp, useEnrollment, useSetTaskState } from "../queries";
import { capitalise, shortDate, useToday, weekdayShort } from "../today";
import { SidePane } from "./SidePane";
import { TaskCard, type TaskActions } from "./TaskCard";

/** The Today screen for the active Enrollment (spec §7.3). */
export function TodayScreen() {
  const app = useApp();
  const query = useEnrollment(app.data?.activeEnrollmentId);
  if (query.isError) return <p className="error">Couldn&apos;t load the enrollment.</p>;
  if (!query.data) return <p className="mono loading">loading…</p>;
  return <TodayView snapshot={query.data} />;
}

function TodayView({ snapshot }: { snapshot: Snapshot }) {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const mutation = useSetTaskState(snapshot.id);
  const setState = mutation.mutate;

  const run = runInfo(snapshot, today);
  const t = run.day;
  const s = stats(snapshot, today);
  const blocks = blockSignals(snapshot, today);
  const columns = todayColumns(snapshot, today);
  const views = taskViews(snapshot, today);
  const mode = run.beforeStart ? "before" : run.finished ? "after" : "during";

  // `?day=` selects another date of the run; today's own date means no selection.
  const dayParam = params.get("day");
  const viewDay =
    mode === "during" && dayParam && isDate(dayParam) && dayNumber(snapshot, dayParam) !== t
      ? dayNumber(snapshot, dayParam)
      : null;
  const viewDate = viewDay === null ? today : dateOfDay(snapshot, viewDay);
  const setDay = (date: string | null) =>
    setParams(
      (p) => {
        if (date === null) p.delete("day");
        else p.set("day", date);
        return p;
      },
      { replace: true },
    );

  const selected = views.find((v) => v.task.id === selectedId) ?? null;
  const block = snapshot.path.blocks[selected?.blockIndex ?? currentBlockIndex(snapshot, today)]!;

  const actions: TaskActions = {
    toggleDone: (v) =>
      setState({
        taskId: v.task.id,
        status: v.status === "done" ? "todo" : "done",
        statusDate: today,
      }),
    skip: (v) => setState({ taskId: v.task.id, status: "skipped", statusDate: today }),
    unskip: (v) => setState({ taskId: v.task.id, status: "todo", statusDate: today }),
    select: (v) => setSelectedId((id) => (id === v.task.id ? null : v.task.id)),
  };
  const card = (v: TaskView) => (
    <TaskCard
      key={v.task.id}
      v={v}
      t={t}
      today={today}
      selected={v.task.id === selectedId}
      expanded={expanded.has(v.task.id)}
      onExpand={() =>
        setExpanded((set) => {
          const next = new Set(set);
          if (!next.delete(v.task.id)) next.add(v.task.id);
          return next;
        })
      }
      actions={actions}
    />
  );
  const column = (title: string, sub: string, list: TaskView[], extra?: ReactNode) => (
    <section className="col" aria-label={title}>
      <h2 className="serif">
        <span>{title}</span>
        <span className="mono count">{list.length}</span>
      </h2>
      <p className="sub mono">{sub}</p>
      {extra}
      {list.length ? list.map(card) : <p className="empty mono">nothing here</p>}
    </section>
  );

  const hero = (() => {
    const heroBlock = snapshot.path.blocks[currentBlockIndex(snapshot, today)]!;
    if (mode === "before") {
      const n = 1 - t;
      return {
        eyebrow: `starts ${shortDate(snapshot.startDate)} · in ${n} day${n === 1 ? "" : "s"}`,
        heading: (
          <>
            Almost <em>ready</em>.
          </>
        ),
        goal: <>{snapshot.path.title}. Day 1 is below; you can tick things off early.</>,
      };
    }
    if (mode === "after") {
      return {
        eyebrow: `path finished · ${shortDate(today)}`,
        heading: (
          <>
            You <em>finished</em> it.
          </>
        ),
        goal: <>{snapshot.path.title}</>,
      };
    }
    return {
      eyebrow: [
        `day ${t}`,
        `week ${run.week} of ${run.weeks}`,
        shortDate(today),
        run.rhythm && `${run.rhythm.toLowerCase()} day`,
      ]
        .filter(Boolean)
        .join(" · "),
      heading: (
        <>
          Today<em>.</em>
        </>
      ),
      goal: (
        <>
          <span className="mono block-title">{heroBlock.title}</span>
          {heroBlock.goal}
        </>
      ),
    };
  })();

  const percent = s.percent === null ? "—" : `${s.percent}%`;
  const statList =
    mode === "after"
      ? [
          ["required done", percent],
          ["bonus tasks", `+${s.bonus}`],
          ["longest streak", String(s.longestStreak)],
        ]
      : [
          ["required done", percent],
          ["bonus tasks", `+${s.bonus}`],
          ["day streak", String(s.streak)],
        ];

  const shiftPlaceholder =
    columns.catchUp.length > 0 ? (
      <div className="shift">
        <button type="button" className="pill sm" disabled>
          Shift open tasks
        </button>
        <span className="mono">coming soon</span>
      </div>
    ) : null;

  let main: ReactNode;
  if (mode === "before") {
    main = (
      <div className="cols one">
        {column("Day 1", shortDate(snapshot.startDate), tasksOnDay(snapshot, today, 1))}
      </div>
    );
  } else if (mode === "after") {
    main = (
      <>
        <div className="edge">
          <h2 className="serif">
            {s.requiredDone} of {s.required}
          </h2>
          <p className="mono">
            required tasks · {percent} · +{s.bonus} bonus · longest streak {s.longestStreak}{" "}
            {s.longestStreak === 1 ? "day" : "days"}
          </p>
        </div>
        <div className="cols one">
          {column("Still open", "overdue after the last day", columns.catchUp, shiftPlaceholder)}
        </div>
      </>
    );
  } else {
    const shownDay = viewDay ?? t;
    const week = Math.min(Math.max(pathWeek(shownDay), 1), run.weeks);
    const strip = weekStrip(snapshot, today, week);
    const middle =
      viewDay === null
        ? column("Today", run.rhythm.toLowerCase() || "off day", columns.today)
        : column(
            capitalise(shortDate(viewDate)),
            `${rhythmLabel(snapshot, viewDay).toLowerCase() || "off day"} · ${viewDay < t ? "past" : "ahead"}`,
            tasksOnDay(snapshot, today, viewDay),
            <button type="button" className="pill sm ghost back" onClick={() => setDay(null)}>
              ← back to today
            </button>,
          );
    const shown = new Set(
      [...columns.catchUp, ...columns.today, ...columns.inProgress].map((v) => v.task.id),
    );
    const alsoDone = views.filter(
      (v) => v.status === "done" && v.statusDate === today && !shown.has(v.task.id),
    );
    main = (
      <>
        <div className="week" role="group" aria-label={`Week ${week}`}>
          {strip.map((d) => (
            <button
              type="button"
              key={d.day}
              className={`day${d.isToday ? " today" : ""}${d.day === viewDay ? " viewing" : ""}`}
              aria-pressed={d.day === shownDay}
              aria-label={`${shortDate(d.date)}, ${d.dots.length} task${d.dots.length === 1 ? "" : "s"}`}
              onClick={() => setDay(d.isToday || d.day === viewDay ? null : d.date)}
            >
              <span className="mono">{weekdayShort(d.date)}</span>{" "}
              <span className="d">{Number(d.date.slice(8))}</span>
              <span className="lbl mono">{d.rhythm.toLowerCase() || "off"}</span>
              <span className="dots">
                {d.dots.map((dot) => (
                  <i key={dot.taskId} className={dot.dot} data-task={dot.taskId} />
                ))}
              </span>
            </button>
          ))}
        </div>
        <div className="cols">
          {column("Catch up", "overdue, oldest first", columns.catchUp, shiftPlaceholder)}
          {middle}
          {column("In progress", "started earlier, still open", columns.inProgress)}
        </div>
        {alsoDone.length > 0 && (
          <p className="mono also">
            also done today · {alsoDone.map((v) => v.task.title).join(" · ")}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="today-screen">
      <section className="hero today-hero">
        <div>
          <p className="eyebrow mono">
            <span className="dot pulse" aria-hidden="true" />
            {hero.eyebrow}
          </p>
          <h1 className="serif">{hero.heading}</h1>
          <p className="goal">{hero.goal}</p>
        </div>
        <dl className="stats">
          {statList.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="blocks" role="list" aria-label="Required tasks done per block">
          {blocks.map((b) => {
            const title = snapshot.path.blocks[b.blockIndex]!.title;
            const pct = b.required ? (100 * b.requiredDone) / b.required : 0;
            return (
              <div
                key={b.blockIndex}
                role="listitem"
                style={{ flex: Math.max(b.required, 1) }}
                title={`${title}: ${b.requiredDone}/${b.required}`}
                aria-label={`${title}: ${b.requiredDone} of ${b.required}`}
              >
                <span style={{ width: `${pct}%` }} />
              </div>
            );
          })}
        </div>
      </section>
      <div className="board">
        <div className="board-main">{main}</div>
        <SidePane
          selected={selected}
          t={t}
          today={today}
          noteDate={viewDate}
          block={block}
          setState={setState}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
  );
}
