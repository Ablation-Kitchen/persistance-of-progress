import { useState } from "react";
import { isDate, type Block, type TaskView } from "@learning-tracker/core";
import { shortDate } from "../today";
import { Description, KindLabel, TaskLinks, statusText } from "./TaskCard";
import { useApp, type TaskStateChange } from "../queries";
import { NoteEditor } from "../notes/NoteEditor";

/** A Note editor for the active Enrollment. */
function ActiveNoteEditor(props: Omit<Parameters<typeof NoteEditor>[0], "enrollmentId">) {
  const id = useApp().data?.activeEnrollmentId;
  return id ? <NoteEditor enrollmentId={id} {...props} /> : null;
}

interface Props {
  selected: TaskView | null;
  t: number;
  today: string;
  /** The date whose Day Note the pane shows: today, or the `?day=` date. */
  noteDate: string;
  block: Block;
  setState: (change: TaskStateChange) => void;
  onClose: () => void;
}

/** Task details with Done/Skip and "did it on…", the Notes, and the Block goal (spec §7.3). */
export function SidePane({ selected, t, today, noteDate, block, setState, onClose }: Props) {
  return (
    <aside className="side" aria-label="Details and notes">
      {selected ? (
        <TaskDetails
          key={selected.task.id}
          v={selected}
          t={t}
          today={today}
          setState={setState}
          onClose={onClose}
        />
      ) : (
        <p className="mono">select a task to see details and its note</p>
      )}
      <section className="sec" aria-label="Day note">
        <ActiveNoteEditor
          target={`day:${noteDate}`}
          label={`day note · ${shortDate(noteDate)}`}
          placeholder="Findings, links, thoughts"
        />
      </section>
      <section className="sec" aria-label="Block goal">
        <p className="mono label">block goal · {block.title}</p>
        <p className="goal-sm">{block.goal}</p>
      </section>
    </aside>
  );
}

function TaskDetails({
  v,
  t,
  today,
  setState,
  onClose,
}: Omit<Props, "selected" | "noteDate" | "block"> & { v: TaskView }) {
  const [didOn, setDidOn] = useState(today);
  const done = v.status === "done";
  const status = statusText(v, t, today);
  const id = v.task.id;
  const dateValue = done && v.statusDate ? v.statusDate : didOn;

  return (
    <div className="details">
      <KindLabel v={v} />
      <h3 className="serif">{v.task.title}</h3>
      {status.text && (
        <p className={`mono${status.tone ? ` status-${status.tone}` : ""}`}>{status.text}</p>
      )}
      <Description text={v.task.description} />
      <TaskLinks links={v.task.links} />
      <div className="actions">
        {done ? (
          <button
            type="button"
            className="pill sm"
            onClick={() => setState({ taskId: id, status: "todo", statusDate: today })}
          >
            Mark not done
          </button>
        ) : (
          <button
            type="button"
            className="pill sm solid"
            disabled={!isDate(didOn)}
            onClick={() => setState({ taskId: id, status: "done", statusDate: didOn })}
          >
            {v.task.kind === "checkpoint" ? "Yes, I can" : "Done"}
          </button>
        )}
        {v.status === "todo" && (
          <button
            type="button"
            className="pill sm"
            onClick={() => setState({ taskId: id, status: "skipped", statusDate: today })}
          >
            Skip
          </button>
        )}
        {v.status === "skipped" && (
          <button
            type="button"
            className="pill sm"
            onClick={() => setState({ taskId: id, status: "todo", statusDate: today })}
          >
            Unskip
          </button>
        )}
        <button type="button" className="pill sm ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="did-on">
        <span className="mono">did it on</span>
        <input
          type="date"
          value={dateValue}
          onChange={(e) => {
            const value = e.target.value;
            setDidOn(value);
            // Already done: moving the date re-records it.
            if (done && isDate(value) && value !== v.statusDate) {
              setState({ taskId: id, status: "done", statusDate: value });
            }
          }}
        />
      </label>
      <section className="sec" aria-label="Task note">
        <ActiveNoteEditor
          target={`task:${id}`}
          template={v.task.noteTemplate}
          label="task note"
          placeholder="What you did, what you found"
        />
      </section>
    </div>
  );
}
