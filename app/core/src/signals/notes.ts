/**
 * Derivations for the Notes screen (spec §7.5). Pure in `(snapshot, today, bodies)`; the bodies
 * come from `GET …/notes`, the metadata (trail, fromTemplate) from the snapshot.
 */
import type { NoteMeta, Snapshot, Tombstone } from "../api/snapshot.js";
import { blockSignals, dateOfDay, dayNumber, taskViews, type TaskView } from "./signals.js";

export interface NoteBodyLike {
  target: string;
  body: string;
}

/** Search scope: note text only, or note text plus Task titles (the default). */
export type NoteSearchScope = "notes" | "titles";

export interface NoteSearch {
  q: string;
  scope: NoteSearchScope;
}

/** Case-insensitive substring match. An empty query matches everything. */
export function textMatches(text: string, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return needle === "" || text.toLowerCase().includes(needle);
}

/** Words in a Note: whitespace-separated tokens left after stripping Markdown punctuation. */
export function wordCount(body: string): number {
  const plain = body
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*`|>_~-]+/g, " ")
    .trim();
  return plain === "" ? 0 : plain.split(/\s+/).length;
}

export interface NotesStats {
  notes: number;
  /** Distinct dates in any Note's edit trail. */
  daysWithEdit: number;
  words: number;
}

export function notesStats(
  snapshot: Pick<Snapshot, "noteMeta">,
  bodies: NoteBodyLike[],
): NotesStats {
  const days = new Set(snapshot.noteMeta.flatMap((m) => m.editedOn));
  return {
    notes: snapshot.noteMeta.length,
    daysWithEdit: days.size,
    words: bodies.reduce((n, b) => n + wordCount(b.body), 0),
  };
}

/**
 * The Block a date belongs to: the one whose effective range holds its day number (the first, if
 * shifted ranges overlap); outside every range, the nearest earlier Block, else the first.
 */
export function blockOfDate(snapshot: Snapshot, today: string, date: string): number {
  const d = dayNumber(snapshot, date);
  const blocks = blockSignals(snapshot, today).filter((b) => Number.isFinite(b.first));
  const inside = blocks.find((b) => b.first <= d && d <= b.last);
  if (inside) return inside.blockIndex;
  const earlier = blocks.filter((b) => b.last < d);
  return earlier.at(-1)?.blockIndex ?? blocks[0]?.blockIndex ?? 0;
}

/** What a listed Task row shows when it has no Note. */
export type NoteGap =
  /** A reached reflection: dashed "not written yet" with Write. */
  | "not-written"
  /** A Task with a `noteTemplate`: "template ready" with Write. */
  | "template"
  /** A future reflection: "opens <date>". */
  | "opens"
  /** A reached exercise: a small "+ note" link. */
  | "add-note";

export interface NoteRow {
  view: TaskView;
  target: string;
  /** Present when the Task has a Note (a blank Note is still a Note). */
  note: { body: string; meta: NoteMeta } | null;
  gap: NoteGap | null;
  /** The effective date (for "opens <date>"). */
  opensOn: string;
}

export interface DayNoteItem {
  date: string;
  target: string;
  /** `null` for today's empty slot ("+ write"). */
  note: { body: string; meta: NoteMeta } | null;
  isToday: boolean;
}

export interface BlockNotes {
  blockIndex: number;
  /** Rows in path order, filtered by the search. */
  rows: NoteRow[];
  /** Day Notes assigned to the Block, by date, plus today's slot when not searching. */
  dayNotes: DayNoteItem[];
  /** Task Notes in the Block (unfiltered). */
  taskNotes: number;
  /** Reached reflections with a Note / reached reflections (unfiltered). */
  reflectionsWritten: number;
  reflectionsReached: number;
  /** The chip count: the Block's Notes, or its matches while searching. */
  count: number;
  /** The Block's effective date range. */
  firstDate: string;
  lastDate: string;
}

function noteIndex(snapshot: Snapshot, bodies: NoteBodyLike[]) {
  const text = new Map(bodies.map((b) => [b.target, b.body]));
  const map = new Map<string, { body: string; meta: NoteMeta }>();
  for (const meta of snapshot.noteMeta) {
    map.set(meta.target, { body: text.get(meta.target) ?? "", meta });
  }
  return map;
}

/** Per Block: the listed Tasks, Day Notes and counts (spec §7.5). */
export function notesByBlock(
  snapshot: Snapshot,
  today: string,
  bodies: NoteBodyLike[],
  search: NoteSearch = { q: "", scope: "titles" },
): BlockNotes[] {
  const t = dayNumber(snapshot, today);
  const notes = noteIndex(snapshot, bodies);
  const views = taskViews(snapshot, today);
  const searching = search.q.trim() !== "";
  const signals = blockSignals(snapshot, today);

  const dayTargets = [...notes.keys()].filter((k) => k.startsWith("day:")).sort();
  const dayBlock = new Map(dayTargets.map((k) => [k, blockOfDate(snapshot, today, k.slice(4))]));
  const todayBlock = t >= 1 ? blockOfDate(snapshot, today, today) : null;

  return snapshot.path.blocks.map((_, blockIndex) => {
    const own = views.filter((v) => v.blockIndex === blockIndex);
    const all: NoteRow[] = [];
    for (const view of own) {
      const target = `task:${view.task.id}`;
      const note = notes.get(target) ?? null;
      const reached = view.effDay <= t;
      let gap: NoteGap | null = null;
      if (!note) {
        if (view.task.noteTemplate) gap = "template";
        else if (view.task.kind === "reflection") gap = reached ? "not-written" : "opens";
        else if (view.task.kind === "exercise" && reached) gap = "add-note";
        else continue;
      }
      all.push({ view, target, note, gap, opensOn: view.effDate });
    }
    const rows = all.filter(
      (r) =>
        !searching ||
        (r.note !== null && textMatches(r.note.body, search.q)) ||
        (search.scope === "titles" && textMatches(r.view.task.title, search.q)),
    );

    const dayNotes: DayNoteItem[] = dayTargets
      .filter((k) => dayBlock.get(k) === blockIndex)
      .map((k) => ({
        date: k.slice(4),
        target: k,
        note: notes.get(k)!,
        isToday: k === `day:${today}`,
      }))
      .filter((d) => !searching || textMatches(d.note!.body, search.q));
    if (!searching && todayBlock === blockIndex && !dayNotes.some((d) => d.isToday)) {
      dayNotes.push({ date: today, target: `day:${today}`, note: null, isToday: true });
      dayNotes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    const taskNotes = all.filter((r) => r.note !== null).length;
    const reflections = all.filter((r) => r.view.task.kind === "reflection" && r.view.effDay <= t);
    const ownDayNotes = dayTargets.filter((k) => dayBlock.get(k) === blockIndex).length;
    const sig = signals[blockIndex]!;
    return {
      blockIndex,
      rows,
      dayNotes,
      taskNotes,
      reflectionsWritten: reflections.filter((r) => r.note !== null).length,
      reflectionsReached: reflections.length,
      count: searching
        ? rows.filter((r) => r.note !== null || search.scope === "titles").length +
          dayNotes.filter((d) => d.note !== null).length
        : taskNotes + ownDayNotes,
      firstDate: Number.isFinite(sig.first) ? dateOfDay(snapshot, sig.first) : snapshot.startDate,
      lastDate: Number.isFinite(sig.last) ? dateOfDay(snapshot, sig.last) : snapshot.startDate,
    };
  });
}

export interface RemovedNote {
  tombstone: Tombstone;
  target: string;
  note: { body: string; meta: NoteMeta };
}

/** Removed Tasks that have a Note, by former day; filtered by the search. */
export function removedNotes(
  snapshot: Snapshot,
  bodies: NoteBodyLike[],
  search: NoteSearch = { q: "", scope: "titles" },
): RemovedNote[] {
  const notes = noteIndex(snapshot, bodies);
  return [...snapshot.tombstones]
    .sort((a, b) => a.formerDay - b.formerDay || (a.taskId < b.taskId ? -1 : 1))
    .flatMap((tombstone) => {
      const target = `task:${tombstone.taskId}`;
      const note = notes.get(target);
      if (!note) return [];
      const hit =
        textMatches(note.body, search.q) ||
        (search.scope === "titles" && textMatches(tombstone.title, search.q));
      return hit ? [{ tombstone, target, note }] : [];
    });
}
