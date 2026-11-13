import { useEffect, useId, type ReactNode } from "react";
import { dayNumber, taskViews, type Snapshot } from "@learning-tracker/core";
import { shortDate, useToday } from "../today";
import { NoteEditor } from "./NoteEditor";

interface DrawerProps {
  title: ReactNode;
  /** A context line above the title. */
  context?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** A side drawer over a backdrop. Esc or a backdrop click closes it (spec §7.5). */
export function Drawer({ title, context, onClose, children }: DrawerProps) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="drawer-scrim" data-testid="drawer-backdrop" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-top">
          {context && <p className="mono">{context}</p>}
          <button type="button" className="pill sm ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <h2 id={titleId} className="serif">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * The drawer editor for any Note: a Task's (live or removed), a Day Note or the Enrollment Note.
 * It shows the context line, the title and the Task's description as the prompt.
 */
export function NoteDrawer({
  snapshot,
  target,
  onClose,
}: {
  snapshot: Snapshot;
  target: string;
  onClose: () => void;
}) {
  const today = useToday();
  const meta = snapshot.noteMeta.find((m) => m.target === target);
  let title: ReactNode;
  let context: string[] = [];
  let prompt: string | undefined;
  let template: string | undefined;

  if (target.startsWith("task:")) {
    const taskId = target.slice(5);
    const live = taskViews(snapshot, today).find((v) => v.task.id === taskId);
    const removed = snapshot.tombstones.find((t) => t.taskId === taskId);
    if (live) {
      title = live.task.title;
      prompt = live.task.description;
      template = live.task.noteTemplate;
      context = [live.task.kind, `day ${live.effDay}`, live.overdue ? "overdue" : live.status];
    } else {
      title = removed?.title ?? taskId;
      context = [removed?.kind ?? "task", `was day ${removed?.formerDay ?? "?"}`, "removed"];
    }
  } else if (target.startsWith("day:")) {
    const date = target.slice(4);
    title = shortDate(date);
    context = ["day note", `day ${dayNumber(snapshot, date)}`];
  } else {
    title = "About this run";
    context = ["enrollment note"];
  }
  if (meta?.fromTemplate) context.push("from template");

  return (
    <Drawer title={title} context={context.join(" · ")} onClose={onClose}>
      {prompt && <p className="drawer-prompt">{prompt}</p>}
      <NoteEditor
        enrollmentId={snapshot.id}
        target={target}
        template={template}
        label="note"
        placeholder="What you did, what you found"
        tall
      />
    </Drawer>
  );
}
