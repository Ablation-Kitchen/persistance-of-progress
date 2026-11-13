import { useState } from "react";
import { isDate, type IssueJson as Issue, type Weekday } from "@learning-tracker/core";
import { capitalise, nextWeekday, useToday } from "../today";
import { IssueList } from "./IssueList";

interface Props {
  title: string;
  startWeekday?: Weekday | undefined;
  pending: boolean;
  error?: { message: string; issues: Issue[] } | null;
  onConfirm: (startDate: string) => void;
  onCancel: () => void;
}

/** Pick the start date: next Monday by default, today one click away (spec §7.2). */
export function StartDateDialog({
  title,
  startWeekday,
  pending,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const today = useToday();
  const [date, setDate] = useState(() => nextWeekday(today));
  const hinted =
    startWeekday && startWeekday !== "monday" ? nextWeekday(today, startWeekday) : null;

  return (
    <div className="scrim" onClick={onCancel}>
      <div
        className="dialog card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <p className="mono">start date</p>
        <h2 id="start-title" className="serif">
          {title}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isDate(date)) onConfirm(date);
          }}
        >
          <label className="field">
            <span className="mono">Day 1 is</span>
            <input
              type="date"
              value={date}
              required
              onChange={(e) => setDate(e.target.value)}
              autoFocus
            />
          </label>
          <div className="row">
            <button type="button" className="pill sm" onClick={() => setDate(today)}>
              Today
            </button>
            <button type="button" className="pill sm" onClick={() => setDate(nextWeekday(today))}>
              Next Monday
            </button>
            {hinted && (
              <button type="button" className="pill sm" onClick={() => setDate(hinted)}>
                Next {capitalise(startWeekday!)}
              </button>
            )}
          </div>
          {startWeekday && (
            <p className="hint">This path is designed to start on a {capitalise(startWeekday)}.</p>
          )}
          {error && (
            <div className="error" role="alert">
              <p>{error.message}</p>
              {error.issues.length > 0 && <IssueList issues={error.issues} />}
            </div>
          )}
          <div className="row end">
            <button type="button" className="pill" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="pill solid" disabled={pending || !isDate(date)}>
              {pending ? "Starting…" : "Start"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
