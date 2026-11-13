import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  currentBlockIndex,
  isDate,
  notesByBlock,
  notesStats,
  removedNotes,
  runInfo,
  type NoteMeta,
  type NoteSearchScope,
  type NoteRow,
  type Snapshot,
} from "@learning-tracker/core";
import { useApp, useEnrollment } from "../queries";
import { shortDate, useToday } from "../today";
import { useNotes } from "./api";
import { NoteDrawer } from "./Drawer";
import { NoteView } from "./NoteView";

/** The Notes screen for the active Enrollment (spec §7.5). */
export function NotesScreen() {
  const app = useApp();
  const id = app.data?.activeEnrollmentId;
  const snapshot = useEnrollment(id);
  const notes = useNotes(id);
  if (snapshot.isError || notes.isError) return <p className="error">Couldn&apos;t load notes.</p>;
  if (!snapshot.data || !notes.data) return <p className="mono loading">loading…</p>;
  return <NotesView snapshot={snapshot.data} bodies={notes.data} />;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** "How LLMs work and run" from "Weeks 1–3: How LLMs work and run". */
const blockName = (title: string) => title.replace(/^[^:]*\d[^:]*:\s*/, "");

/** `text` with case-insensitive matches of `q` in `<mark>`. */
function Hl({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  if (!needle) return <>{text}</>;
  const re = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}</>;
}

/** A `note=` target the drawer can open: a live or removed Task, a real date, or `enrollment`. */
function openable(snapshot: Snapshot, target: string): boolean {
  if (target === "enrollment") return true;
  if (target.startsWith("day:")) return isDate(target.slice(4));
  if (!target.startsWith("task:")) return false;
  const id = target.slice(5);
  return (
    snapshot.tombstones.some((t) => t.taskId === id) ||
    snapshot.path.blocks.some((b) => b.tasks.some((t) => t.id === id))
  );
}

/** Long Notes and tables render clipped to ~6 lines, with more/less. */
const isLong = (body: string) =>
  body.split("\n").length > 6 || body.length > 320 || body.includes("|");

function Trail({ meta }: { meta: NoteMeta }) {
  if (meta.editedOn.length === 0) return <span className="mono">not edited yet</span>;
  return <span className="mono">edited on {meta.editedOn.map(shortDate).join(", ")}</span>;
}

function NotesView({
  snapshot,
  bodies,
}: {
  snapshot: Snapshot;
  bodies: { target: string; body: string }[];
}) {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const q = params.get("q") ?? "";
  const scope: NoteSearchScope = params.get("scope") === "notes" ? "notes" : "titles";
  const search = { q, scope };
  const noteParam = params.get("note");
  const set = (key: string, value: string | null) =>
    setParams(
      (p) => {
        if (value === null || value === "") p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: true },
    );
  const openNote = (target: string) => set("note", target);

  const run = runInfo(snapshot, today);
  const stats = notesStats(snapshot, bodies);
  const blocks = notesByBlock(snapshot, today, bodies, search);
  const removed = removedNotes(snapshot, bodies, search);
  const anyRemoved = removedNotes(snapshot, bodies).length > 0;

  const rawBlock = params.get("block");
  const n = Number(rawBlock);
  const selected: number | "removed" =
    rawBlock === "removed" && anyRemoved
      ? "removed"
      : Number.isInteger(n) && n >= 1 && n <= blocks.length
        ? n - 1
        : currentBlockIndex(snapshot, today);

  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const body = (key: string, text: string) => {
    const full = expanded.has(key);
    const long = isLong(text);
    return {
      view: (
        <div className={`note-clip${long && !full ? " clipped" : ""}`}>
          {text.trim() ? (
            <NoteView body={text} highlight={q} />
          ) : (
            <p className="hint">Blank note.</p>
          )}
        </div>
      ),
      more: long ? (
        <button type="button" className="linkbtn" aria-expanded={full} onClick={() => toggle(key)}>
          {full ? "less −" : "more +"}
        </button>
      ) : null,
    };
  };

  const eyebrow = run.beforeStart
    ? `starts ${shortDate(snapshot.startDate)}`
    : run.finished
      ? `path finished · ${shortDate(today)}`
      : `day ${run.day} · week ${run.week} of ${run.weeks} · ${shortDate(today)}`;

  const enrollment = bodies.find((b) => b.target === "enrollment");
  const enrollmentMeta = snapshot.noteMeta.find((m) => m.target === "enrollment");

  let main: ReactNode;
  let side: ReactNode = null;
  if (selected === "removed") {
    main = (
      <section className="panel notes-main" aria-label="Removed tasks">
        <h2 className="serif">Removed tasks</h2>
        <p className="mono">no longer in the path file · their notes are kept</p>
        {removed.length === 0 && <p className="mono empty">no matches</p>}
        {removed.map((r) => {
          const b = body(r.target, r.note.body);
          return (
            <article key={r.target} className="trow" data-target={r.target}>
              <div>
                <div className="trow-title">
                  <Hl text={r.tombstone.title} q={scope === "titles" ? q : ""} />
                </div>
                <p className="mono ctx">
                  {r.tombstone.kind} · was day {r.tombstone.formerDay} ·{" "}
                  <span className="status-over">removed</span>
                </p>
              </div>
              <button type="button" className="pill sm" onClick={() => openNote(r.target)}>
                Edit
              </button>
              {b.view}
              <div className="trow-foot">
                <Trail meta={r.note.meta} />
                {b.more}
              </div>
            </article>
          );
        })}
      </section>
    );
  } else {
    const block = blocks[selected]!;
    const authored = snapshot.path.blocks[selected]!;
    const row = (r: NoteRow) => {
      const v = r.view;
      const ctx = (
        <p className="mono ctx">
          {v.task.kind}
          {v.optional && " · optional"} · day {v.effDay} · {shortDate(v.effDate)} ·{" "}
          <span className={v.status === "done" ? "status-ok" : v.overdue ? "status-over" : ""}>
            {v.overdue ? "overdue" : v.status === "todo" ? "open" : v.status}
          </span>
          {r.note?.meta.fromTemplate && <span className="tag">from template</span>}
        </p>
      );
      const title = (
        <div className="trow-title">
          <Hl text={v.task.title} q={scope === "titles" ? q : ""} />
        </div>
      );
      if (r.note) {
        const b = body(r.target, r.note.body);
        return (
          <article key={r.target} className="trow" data-target={r.target}>
            <div>
              {title}
              {ctx}
            </div>
            <button type="button" className="pill sm" onClick={() => openNote(r.target)}>
              Edit
            </button>
            {b.view}
            <div className="trow-foot">
              <Trail meta={r.note.meta} />
              {b.more}
            </div>
          </article>
        );
      }
      if (r.gap === "add-note") {
        return (
          <article key={r.target} className="trow" data-target={r.target}>
            <div>
              {title}
              {ctx}
            </div>
            <button type="button" className="linkbtn" onClick={() => openNote(r.target)}>
              + note
            </button>
          </article>
        );
      }
      const text =
        r.gap === "template"
          ? "template ready"
          : r.gap === "not-written"
            ? "not written yet"
            : `opens ${shortDate(r.opensOn)}`;
      return (
        <article key={r.target} className="trow" data-target={r.target}>
          <div>
            {title}
            {ctx}
          </div>
          <span />
          <div className={`gap${r.gap === "not-written" ? " due" : ""}`}>
            <span className="mono">{text}</span>
            {r.gap !== "opens" && (
              <button type="button" className="pill sm" onClick={() => openNote(r.target)}>
                Write
              </button>
            )}
          </div>
        </article>
      );
    };
    main = (
      <section className="panel notes-main" aria-label={`Block ${selected + 1}`}>
        <p className="mono">
          block {selected + 1} of {blocks.length} · {block.taskNotes} task note
          {block.taskNotes === 1 ? "" : "s"} · reflections {block.reflectionsWritten}/
          {block.reflectionsReached} written so far
        </p>
        <h2 className="serif">{blockName(authored.title)}</h2>
        <p className="goal-sm">{authored.goal}</p>
        {block.rows.length ? (
          block.rows.map(row)
        ) : (
          <p className="mono empty">{q.trim() ? "no matches in this block" : "nothing here yet"}</p>
        )}
      </section>
    );
    side = (
      <aside className="panel day-notes" aria-label="Day notes">
        <h3 className="serif">Day notes</h3>
        <p className="mono">
          {shortDate(block.firstDate)} – {shortDate(block.lastDate)}
        </p>
        {block.dayNotes.length === 0 ? (
          <p className="mono">no day notes in this block</p>
        ) : (
          <ol className="tl">
            {block.dayNotes.map((d) => (
              <li
                key={d.target}
                className={`tl-i${d.note ? " has" : ""}${d.isToday ? " today" : ""}`}
                data-target={d.target}
              >
                <div className="tl-head">
                  <span className="mono">
                    {shortDate(d.date)}
                    {d.isToday && " · today"}
                  </span>
                  <button type="button" className="linkbtn" onClick={() => openNote(d.target)}>
                    {d.note ? "edit" : "+ write"}
                  </button>
                </div>
                {d.note && body(d.target, d.note.body).view}
              </li>
            ))}
          </ol>
        )}
      </aside>
    );
  }

  return (
    <div className="notes-screen">
      <section className="hero notes-hero">
        <div>
          <p className="eyebrow mono">
            <span className="dot pulse" aria-hidden="true" />
            {eyebrow}
          </p>
          <h1 className="serif">
            Notes, <em>by block</em>.
          </h1>
        </div>
        <dl className="stats">
          {(
            [
              ["notes", stats.notes],
              ["days with an edit", stats.daysWithEdit],
              ["words", stats.words],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value.toLocaleString("en-GB")}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel about" aria-label="About this run">
        <div className="about-head">
          <span className="mono">enrollment note · about this run</span>
          <button type="button" className="pill sm" onClick={() => openNote("enrollment")}>
            {enrollmentMeta ? "Edit" : "Write"}
          </button>
        </div>
        {enrollment && enrollment.body.trim() ? (
          <div className="about-body">
            <NoteView body={enrollment.body} highlight={q} />
          </div>
        ) : (
          <p className="hint">Why you&apos;re doing this run, and your rules for it.</p>
        )}
      </section>

      <div className="notes-toolbar">
        <input
          type="search"
          className="search"
          aria-label="Search notes"
          placeholder="Search notes"
          value={q}
          onChange={(e) => set("q", e.target.value)}
        />
        <span className="chips" role="group" aria-label="Search scope">
          <span className="mono">in</span>
          <button
            type="button"
            className={`pill sm${scope === "notes" ? " on" : ""}`}
            aria-pressed={scope === "notes"}
            onClick={() => set("scope", "notes")}
          >
            note text
          </button>
          <button
            type="button"
            className={`pill sm${scope === "titles" ? " on" : ""}`}
            aria-pressed={scope === "titles"}
            onClick={() => set("scope", null)}
          >
            + task titles
          </button>
        </span>
      </div>

      <div className="chips block-chips" role="group" aria-label="Blocks">
        {blocks.map((b) => {
          const name = `${pad2(b.blockIndex + 1)} ${blockName(snapshot.path.blocks[b.blockIndex]!.title)}`;
          return (
            <button
              type="button"
              key={b.blockIndex}
              className={`pill sm${selected === b.blockIndex ? " on" : ""}`}
              aria-pressed={selected === b.blockIndex}
              onClick={() => set("block", String(b.blockIndex + 1))}
            >
              {name} <span className="mono chip-count">{b.count}</span>
            </button>
          );
        })}
        {anyRemoved && (
          <button
            type="button"
            className={`pill sm${selected === "removed" ? " on" : ""}`}
            aria-pressed={selected === "removed"}
            onClick={() => set("block", "removed")}
          >
            Removed tasks <span className="mono chip-count">{removed.length}</span>
          </button>
        )}
      </div>

      <div className="notes-layout">
        {main}
        {side}
      </div>

      {noteParam && openable(snapshot, noteParam) && (
        <NoteDrawer snapshot={snapshot} target={noteParam} onClose={() => set("note", null)} />
      )}
    </div>
  );
}
