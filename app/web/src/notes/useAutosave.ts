import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { applySaved, putNote } from "./api";

/** Quiet time before a save. */
export const DEBOUNCE_MS = 800;
/** Continuous typing still saves at least this often. */
export const MAX_WAIT_MS = 3_000;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Options {
  enrollmentId: string;
  target: string;
  /** The Task's `noteTemplate`: until the Note exists, a save sends `fromTemplate: true`. */
  template: string | undefined;
  /** Whether a stored Note exists when the editor opens. */
  stored: boolean;
  /** The learner's local date, sent as `editedOn`. */
  today: string;
}

/**
 * Whole-body autosave (spec §10): ~800 ms debounce, flushed immediately on blur, Esc, close
 * (unmount) and `pagehide`/`visibilitychange` (with `keepalive`). Saves run one at a time in
 * order, so the last text written is the last text saved. Last write wins; no version check.
 */
export function useAutosave(options: Options) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const opts = useRef(options);
  useLayoutEffect(() => {
    opts.current = options;
  });
  const state = useRef({
    text: "",
    dirty: false,
    created: options.stored,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    pendingSince: null as number | null,
    queue: Promise.resolve(),
    inFlight: 0,
  });

  const flush = useCallback(
    (keepalive = false) => {
      const s = state.current;
      clearTimeout(s.timer);
      s.pendingSince = null;
      if (!s.dirty) return;
      s.dirty = false;
      const { enrollmentId, target, template, today } = opts.current;
      const body = s.text;
      setStatus("saving");
      const run = async () => {
        try {
          const fromTemplate = !s.created && template !== undefined;
          const res = await putNote(
            enrollmentId,
            target,
            { body, editedOn: today, ...(fromTemplate && { fromTemplate: true }) },
            keepalive,
          );
          s.created = true;
          applySaved(qc, enrollmentId, body, res);
          if (!s.dirty) setStatus("saved");
        } catch {
          // Keep the text pending: the next edit or flush retries it.
          s.dirty = true;
          setStatus("error");
        }
      };
      // Start at once when idle, so a flush on `pagehide` sends before the page goes; behind
      // a save in flight, wait for it so saves land in order. A keepalive flush never waits.
      const started = s.inFlight === 0 || keepalive ? run() : s.queue.then(run);
      s.inFlight++;
      s.queue = started.finally(() => {
        s.inFlight--;
      });
    },
    [qc],
  );

  const change = useCallback(
    (text: string) => {
      const s = state.current;
      s.text = text;
      s.dirty = true;
      setStatus("saving");
      clearTimeout(s.timer);
      const now = Date.now();
      s.pendingSince ??= now;
      const delay = Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (now - s.pendingSince));
      s.timer = setTimeout(() => flush(), Math.max(0, delay));
    },
    [flush],
  );

  /** After a delete: nothing pending, and the next save creates the Note again. */
  const reset = useCallback(() => {
    const s = state.current;
    clearTimeout(s.timer);
    s.dirty = false;
    s.pendingSince = null;
    s.created = false;
    setStatus("idle");
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const onPageHide = () => flush(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      flush(true); // closing the editor (drawer close, selection change) saves at once
    };
  }, [flush]);

  return { status, change, flush, reset };
}
