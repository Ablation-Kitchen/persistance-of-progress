/**
 * The Resource Index (spec §7.4, glossary): the de-duplicated list of everything a path points
 * to, its core resources plus every Task link. Derived, never stored.
 */
import type { Snapshot } from "../api/snapshot.js";
import { byPathOrder, taskViews, type TaskView } from "../signals/signals.js";

export interface ResourceUse {
  taskId: string;
  title: string;
  blockIndex: number;
  effDay: number;
  done: boolean;
  status: TaskView["status"];
}

export interface ResourceEntry {
  /** `url:<normalised url>` or `book:<normalised title>`. */
  key: string;
  /** The core resource's title when there is one, else the first spelling met. */
  title: string;
  url?: string;
  /** No URL: a book (or another offline reference). */
  isBook: boolean;
  /** Listed in the path's `resources`. */
  isCore: boolean;
  /** Position in `resources`, for core entries. */
  coreIndex: number | null;
  note?: string;
  /** Every other title this resource appears under. */
  otherSpellings: string[];
  /** Using Tasks in path order. Empty for a whole-path reference. */
  uses: ResourceUse[];
  /** The first using Task's effective day; `Infinity` when unused. */
  firstUse: number;
  /** The first using Task's Block; `null` when unused. */
  blockIndex: number | null;
}

/** A URL without scheme or trailing slash, lowercased. */
export function normaliseUrl(url: string): string {
  return url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** A title with any `(…)` removed, punctuation stripped, lowercased. */
export function normaliseTitle(title: string): string {
  return title
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function resourceKey(r: { title: string; url?: string | undefined }): string {
  return r.url ? `url:${normaliseUrl(r.url)}` : `book:${normaliseTitle(r.title)}`;
}

/**
 * Build the index for live Tasks. Core resources come first so that, on a shared key, the core
 * title and note win and every other spelling is listed in `otherSpellings`. Entries are in
 * first-use order (ties: core order, then title).
 */
export function resourceIndex(snapshot: Snapshot, today: string): ResourceEntry[] {
  const entries = new Map<string, ResourceEntry & { spellings: Set<string> }>();
  const entry = (r: { title: string; url?: string | undefined }) => {
    const key = resourceKey(r);
    let e = entries.get(key);
    if (!e) {
      e = {
        key,
        title: r.title,
        ...(r.url !== undefined && { url: r.url }),
        isBook: !r.url,
        isCore: false,
        coreIndex: null,
        otherSpellings: [],
        uses: [],
        firstUse: Infinity,
        blockIndex: null,
        spellings: new Set(),
      };
      entries.set(key, e);
    }
    e.spellings.add(r.title);
    return e;
  };

  (snapshot.path.resources ?? []).forEach((r, i) => {
    const e = entry(r);
    if (e.isCore) return; // a duplicate core resource: the first one wins
    e.isCore = true;
    e.coreIndex = i;
    e.title = r.title;
    if (r.note !== undefined) e.note = r.note;
  });

  const views = taskViews(snapshot, today).sort(byPathOrder);
  for (const v of views) {
    const seen = new Set<string>();
    for (const link of v.task.links ?? []) {
      const e = entry(link);
      if (seen.has(e.key)) continue; // one use per Task, even if it links twice
      seen.add(e.key);
      e.uses.push({
        taskId: v.task.id,
        title: v.task.title,
        blockIndex: v.blockIndex,
        effDay: v.effDay,
        done: v.status === "done",
        status: v.status,
      });
    }
  }

  const result = [...entries.values()].map(({ spellings, ...e }): ResourceEntry => {
    const first = e.uses[0];
    return {
      ...e,
      otherSpellings: [...spellings].filter((s) => s !== e.title),
      firstUse: first?.effDay ?? Infinity,
      blockIndex: first?.blockIndex ?? null,
    };
  });
  return result.sort(byFirstUse);
}

/** First use; ties go to core order (core before non-core), then title. */
export function byFirstUse(a: ResourceEntry, b: ResourceEntry): number {
  if (a.firstUse !== b.firstUse) return a.firstUse < b.firstUse ? -1 : 1;
  const ca = a.coreIndex ?? Number.MAX_SAFE_INTEGER;
  const cb = b.coreIndex ?? Number.MAX_SAFE_INTEGER;
  return ca - cb || a.title.localeCompare(b.title);
}

export function byTitle(a: ResourceEntry, b: ResourceEntry): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

export type ResourceFilter = "all" | "core" | "books" | "todo";

/** The filter chips: all / core / books / still to use (some using Task still `todo`). */
export function resourcePasses(e: ResourceEntry, filter: ResourceFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "core":
      return e.isCore;
    case "books":
      return e.isBook;
    case "todo":
      return e.uses.some((u) => u.status === "todo");
  }
}

/** Search over titles, other spellings, notes, URLs and the using Tasks' titles. */
export function resourceMatches(e: ResourceEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    e.title,
    ...e.otherSpellings,
    e.note ?? "",
    e.url ?? "",
    ...e.uses.map((u) => u.title),
  ].some((s) => s.toLowerCase().includes(q));
}
