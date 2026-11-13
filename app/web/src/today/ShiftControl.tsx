import { useId, useState } from "react";
import { taskViews, type Snapshot } from "@learning-tracker/core";
import { useShift, useUndoShift } from "../queries";
import { shortDate } from "../today";

interface Props {
  snapshot: Snapshot;
  today: string;
  /** Overdue Tasks in Catch up; the shift form shows only when there are some. */
  overdue: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The Catch up shift control (spec §7.3): +N days with a confirmation naming how many open
 * Tasks will move, and undo of the latest undoable shift. Both wait for the server.
 */
export function ShiftControl({ snapshot, today, overdue }: Props) {
  const inputId = useId();
  const [days, setDays] = useState("1");
  const [confirming, setConfirming] = useState(false);
  const shift = useShift(snapshot.id);
  const undo = useUndoShift(snapshot.id);
  const undoable = snapshot.shifts.find((s) => s.undoable) ?? null;
  if (overdue === 0 && !undoable) return null;

  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 365;
  const openCount = taskViews(snapshot, today).filter((v) => v.status === "todo").length;
  const busy = shift.isPending || undo.isPending;
  const error = shift.error ?? undo.error;

  return (
    <div className="shift-control" role="group" aria-label="Schedule shift">
      {overdue > 0 && !confirming && (
        <div className="shift">
          <label className="mono" htmlFor={inputId}>
            shift open tasks by
          </label>
          <input
            id={inputId}
            type="number"
            min={1}
            max={365}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <span className="mono">days</span>
          <button
            type="button"
            className="pill sm"
            disabled={!valid || busy}
            onClick={() => {
              shift.reset();
              setConfirming(true);
            }}
          >
            Shift…
          </button>
        </div>
      )}
      {confirming && (
        <div className="shift-confirm">
          <p>
            {plural(openCount, "open task")} will move +{plural(n, "day")}.
          </p>
          <div className="shift">
            <button
              type="button"
              className="pill sm solid"
              disabled={busy}
              onClick={() =>
                shift.mutate(
                  { days: n, appliedOn: today },
                  { onSuccess: () => setConfirming(false) },
                )
              }
            >
              {shift.isPending ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Shifting…
                </>
              ) : (
                `Move ${plural(openCount, "task")}`
              )}
            </button>
            <button
              type="button"
              className="pill sm ghost"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {undoable && !confirming && (
        <div className="shift">
          <button
            type="button"
            className="pill sm ghost"
            disabled={busy}
            onClick={() => {
              shift.reset();
              undo.mutate();
            }}
          >
            {undo.isPending ? (
              <>
                <span className="spinner" aria-hidden="true" /> Undoing…
              </>
            ) : (
              `Undo +${undoable.days}d`
            )}
          </button>
          <span className="mono">
            shifted {shortDate(undoable.appliedOn)} · {plural(undoable.taskIds.length, "task")}
          </span>
        </div>
      )}
      {error && (
        <p className="error mono" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
