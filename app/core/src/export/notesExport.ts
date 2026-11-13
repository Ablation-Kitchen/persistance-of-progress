/**
 * Notes → Markdown (spec §9.1). Pure in `(snapshot, notes, today)`: one journal-style file of an
 * Enrollment's written Notes, Block → week → day. One-way; never imported back.
 */
import type { NoteMeta, Snapshot } from "../api/snapshot.js";
import { addDays, weekday } from "../dates/dates.js";
import { blockOfDate, type NoteBodyLike } from "../signals/notes.js";
import {
  byPathOrder,
  dayNumber,
  pathWeek,
  stats,
  taskViews,
  type TaskView,
} from "../signals/signals.js";

export interface NotesExport {
  filename: string;
  markdown: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/**
 * Push a Note's headings below its own heading (spec §9.1, §13.8): level k becomes `base + k − 1`,
 * and anything past `######` becomes `**bold**`. Fenced code is left untouched; the rest of the
 * body is copied as-is.
 */
export function demoteHeadings(body: string, base: number): string {
  let fence: string | null = null;
  return body
    .split("\n")
    .map((line) => {
      const f = FENCE.exec(line);
      if (fence !== null) {
        // A closing fence uses the same character, at least as long, and nothing after it.
        if (
          f &&
          f[1]![0] === fence[0] &&
          f[1]!.length >= fence.length &&
          !line.slice(f[0].length).trim()
        ) {
          fence = null;
        }
        return line;
      }
      if (f) {
        fence = f[1]!;
        return line;
      }
      const h = ATX.exec(line);
      if (!h) return line;
      const text = (h[2] ?? "").trim();
      const level = base + h[1]!.length - 1;
      if (level <= 6) return `${"#".repeat(level)}${text ? ` ${text}` : ""}`;
      return text ? `**${text}**` : "";
    })
    .join("\n");
}

/** `<path-id>_<start-date>_notes_<today>.md` (spec §9.1). */
export function notesExportFilename(
  snapshot: Pick<Snapshot, "pathId" | "startDate">,
  today: string,
) {
  return `${snapshot.pathId}_${snapshot.startDate}_notes_${today}.md`;
}

interface DayGroup {
  date: string;
  dayNote: string | null;
  tasks: { view: TaskView; body: string; meta: NoteMeta | undefined }[];
}

/** A Note body without its trailing line breaks, so blocks are separated by exactly one blank line. */
const trimEnd = (body: string) => body.replace(/[\r\n]+$/, "");
const written = (body: string | undefined): body is string => !!body && body.trim() !== "";

function taskMetaLine(v: TaskView, meta: NoteMeta | undefined): string {
  const parts: string[] = [v.optional ? `${v.task.kind} · optional` : v.task.kind];
  if (v.effDue !== v.effDay) parts.push(`due day ${v.effDue}`);
  if (v.status === "done") parts.push(`done ${v.statusDate}`);
  else if (v.status === "skipped") parts.push(`skipped ${v.statusDate}`);
  else parts.push(v.overdue ? "overdue" : "not done");
  if (meta?.fromTemplate) parts.push("from template");
  return `_${parts.join(" · ")}_`;
}

export function notesExport(
  snapshot: Snapshot,
  notes: readonly NoteBodyLike[],
  today: string,
): NotesExport {
  const bodies = new Map(notes.map((n) => [n.target, n.body]));
  const metas = new Map(snapshot.noteMeta.map((m) => [m.target, m]));
  const views = taskViews(snapshot, today);
  const s = stats(snapshot, today);

  // Block → date → that day's Day Note and Task Notes.
  const blocks = new Map<number, Map<string, DayGroup>>();
  const group = (blockIndex: number, date: string): DayGroup => {
    let days = blocks.get(blockIndex);
    if (!days) blocks.set(blockIndex, (days = new Map()));
    let g = days.get(date);
    if (!g) days.set(date, (g = { date, dayNote: null, tasks: [] }));
    return g;
  };
  for (const [target, body] of bodies) {
    if (!target.startsWith("day:") || !written(body)) continue;
    const date = target.slice(4);
    group(blockOfDate(snapshot, today, date), date).dayNote = body;
  }
  for (const v of views) {
    const target = `task:${v.task.id}`;
    const body = bodies.get(target);
    if (!written(body)) continue;
    group(v.blockIndex, v.effDate).tasks.push({ view: v, body, meta: metas.get(target) });
  }

  const out: string[] = [];
  out.push(`# ${snapshot.path.title} — notes`);
  out.push(
    [
      `started ${snapshot.startDate}`,
      `exported on ${today}`,
      `${s.percent === null ? "—" : `${s.percent}%`} required done`,
      `streak ${s.streak}`,
    ].join(" · "),
  );

  const about = bodies.get("enrollment");
  if (written(about)) out.push("## About this run", trimEnd(demoteHeadings(about, 3)));

  // Each shift is shown once, under the first exported week at or after the week it was applied.
  const shifts = [...snapshot.shifts]
    .sort((a, b) => a.appliedOn.localeCompare(b.appliedOn) || a.id - b.id)
    .map((sh) => ({
      week: pathWeek(dayNumber(snapshot, sh.appliedOn)),
      line: `_shifted +${sh.days}d on ${sh.appliedOn}_`,
    }));

  const blockOrder = [...blocks.keys()].sort((a, b) => a - b);
  for (const blockIndex of blockOrder) {
    const block = snapshot.path.blocks[blockIndex]!;
    out.push(`## Block ${blockIndex + 1} · ${block.title}`);
    const days = [...blocks.get(blockIndex)!.values()].sort((a, b) => a.date.localeCompare(b.date));
    let currentWeek: number | null = null;
    for (const g of days) {
      const d = dayNumber(snapshot, g.date);
      const week = d >= 1 ? pathWeek(d) : 0;
      if (week !== currentWeek) {
        currentWeek = week;
        if (week === 0) out.push("### Before the start");
        else {
          const first = addDays(snapshot.startDate, 7 * (week - 1));
          out.push(`### Week ${week} · ${first} – ${addDays(first, 6)}`);
        }
        while (shifts.length && shifts[0]!.week <= week) out.push(shifts.shift()!.line);
      }
      out.push(
        `#### ${WEEKDAYS[weekday(g.date)]} ${g.date} · ${d >= 1 ? `day ${d}` : "before day 1"}`,
      );
      if (g.dayNote !== null) out.push(trimEnd(demoteHeadings(g.dayNote, 5)));
      for (const t of g.tasks.sort((a, b) => byPathOrder(a.view, b.view))) {
        out.push(
          `##### ${t.view.task.title}`,
          taskMetaLine(t.view, t.meta),
          trimEnd(demoteHeadings(t.body, 6)),
        );
      }
    }
  }

  const removed = snapshot.tombstones
    .filter((t) => written(bodies.get(`task:${t.taskId}`)))
    .sort((a, b) => a.formerDay - b.formerDay || a.taskId.localeCompare(b.taskId));
  if (removed.length) {
    out.push("## Removed tasks");
    for (const t of removed) {
      out.push(
        `##### ${t.title}`,
        `_${t.kind} · former day ${t.formerDay} · removed from the path on ${t.removedAt.slice(0, 10)}_`,
        trimEnd(demoteHeadings(bodies.get(`task:${t.taskId}`)!, 6)),
      );
    }
  }

  return { filename: notesExportFilename(snapshot, today), markdown: `${out.join("\n\n")}\n` };
}
