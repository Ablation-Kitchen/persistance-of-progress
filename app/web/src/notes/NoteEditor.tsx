import { useId, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEnrollment } from "../queries";
import { shortDate, useToday } from "../today";
import { useToast } from "../toast";
import { applyDeleted, deleteNote, useNotes } from "./api";
import { NoteView } from "./NoteView";
import { useAutosave, type SaveStatus } from "./useAutosave";

interface Props {
  enrollmentId: string;
  /** `task:<id>` | `day:YYYY-MM-DD` | `enrollment`. */
  target: string;
  label: ReactNode;
  /** The Task's `noteTemplate`, shown (not stored) until the first keystroke. */
  template?: string | undefined;
  placeholder?: string;
  /** Taller box, e.g. in the drawer. */
  tall?: boolean;
}

/**
 * The shared Note editor (spec §7.3, §7.5): Write/Preview, autosave with a "saving… / saved"
 * indicator, the edit-date trail and Delete behind a confirmation.
 */
export function NoteEditor(props: Props) {
  const notes = useNotes(props.enrollmentId);
  if (notes.isError) return <p className="error">Couldn&apos;t load notes.</p>;
  if (!notes.data) return <p className="mono">loading…</p>;
  const stored = notes.data.find((n) => n.target === props.target);
  return (
    <EditorBody
      key={props.target}
      {...props}
      initial={stored ? stored.body : (props.template ?? "")}
      stored={!!stored}
    />
  );
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  saving: "saving…",
  saved: "saved",
  error: "couldn't save, will retry",
};

function EditorBody({
  enrollmentId,
  target,
  label,
  template,
  placeholder,
  tall,
  initial,
  stored,
}: Props & { initial: string; stored: boolean }) {
  const today = useToday();
  const qc = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [text, setText] = useState(initial);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [confirming, setConfirming] = useState(false);
  const autosave = useAutosave({ enrollmentId, target, template, stored, today });
  const meta = useEnrollment(enrollmentId).data?.noteMeta.find((m) => m.target === target);

  async function remove() {
    try {
      const res = await deleteNote(enrollmentId, target);
      autosave.reset();
      applyDeleted(qc, enrollmentId, target, res);
      setText(template ?? "");
      setConfirming(false);
    } catch {
      toast("Couldn't delete, try again");
    }
  }

  return (
    <div className="note-editor">
      <div className="note-head">
        <label className="mono" htmlFor={id}>
          {label}
        </label>
        <span className="mono note-status" aria-live="polite">
          {STATUS_TEXT[autosave.status]}
        </span>
        <div className="note-tabs" role="group" aria-label="Editor mode">
          <button
            type="button"
            className="linkbtn"
            aria-pressed={mode === "write"}
            onClick={() => setMode("write")}
          >
            Write
          </button>
          <button
            type="button"
            className="linkbtn"
            aria-pressed={mode === "preview"}
            onClick={() => {
              autosave.flush();
              setMode("preview");
            }}
          >
            Preview
          </button>
        </div>
      </div>
      {mode === "write" ? (
        <textarea
          id={id}
          className={tall ? "tall" : undefined}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            autosave.change(e.target.value);
          }}
          onBlur={() => autosave.flush()}
          onKeyDown={(e) => {
            if (e.key === "Escape") autosave.flush();
          }}
        />
      ) : (
        <div className="note-preview" id={id}>
          {text.trim() ? <NoteView body={text} /> : <p className="hint">Nothing written yet.</p>}
        </div>
      )}
      <div className="note-foot">
        {meta && meta.editedOn.length > 0 && (
          <span className="mono">edited on {meta.editedOn.map(shortDate).join(", ")}</span>
        )}
        {meta?.fromTemplate && <span className="mono">from template</span>}
        {meta &&
          (confirming ? (
            <span className="row">
              <span className="mono">delete this note?</span>
              <button type="button" className="pill sm danger" onClick={() => void remove()}>
                Delete
              </button>
              <button type="button" className="pill sm" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="linkbtn" onClick={() => setConfirming(true)}>
              Delete note
            </button>
          ))}
      </div>
    </div>
  );
}
