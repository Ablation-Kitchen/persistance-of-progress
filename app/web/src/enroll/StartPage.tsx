import { useState } from "react";
import { RestoreFileButton } from "../backup/RestoreFlow";
import { useNavigate } from "react-router";
import {
  loadPath,
  type IssueJson as Issue,
  type PathSource,
  type Weekday,
} from "@learning-tracker/core";
import { ApiError } from "../api";
import { useCreateEnrollment, usePaths } from "../queries";
import { IssueList } from "./IssueList";
import { StartDateDialog } from "./StartDateDialog";

interface Choice {
  source: PathSource;
  title: string;
  startWeekday?: Weekday | undefined;
}

/**
 * The empty state and "New enrollment" (spec §7.2): Load a path from `/paths`, upload a file, or
 * restore from a Backup.
 */
export function StartPage({ firstRun }: { firstRun: boolean }) {
  const paths = usePaths();
  const create = useCreateEnrollment();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [upload, setUpload] = useState<{ name: string; issues: Issue[] } | null>(null);

  async function onFile(file: File) {
    const yaml = await file.text();
    const result = loadPath(yaml, { source: "yaml" });
    if (!result.ok) {
      setUpload({ name: file.name, issues: result.issues });
      return;
    }
    setUpload(null);
    setChoice({
      source: { filename: file.name, yaml },
      title: result.path.title,
      startWeekday: result.path.startWeekday,
    });
  }

  function confirm(startDate: string) {
    if (!choice) return;
    create.mutate(
      { source: choice.source, startDate },
      { onSuccess: () => void navigate("/today") },
    );
  }

  const createError =
    create.error instanceof ApiError
      ? { message: create.error.message, issues: create.error.issues }
      : create.error
        ? { message: "Couldn't start the enrollment. Try again.", issues: [] }
        : null;

  return (
    <>
      <section className="hero">
        <p className="eyebrow mono">
          <span className="dot" aria-hidden="true" /> {firstRun ? "welcome" : "new enrollment"}
        </p>
        <h1 className="serif">{firstRun ? "Pick a path." : "New enrollment."}</h1>
      </section>

      <div className="start">
        <section aria-labelledby="load-title">
          <h2 id="load-title" className="section-title">
            Load a path
          </h2>
          {paths.isPending ? (
            <p className="mono">reading /paths…</p>
          ) : paths.isError ? (
            <p className="error">Couldn&apos;t read the paths folder.</p>
          ) : paths.data.length === 0 ? (
            <p className="hint">
              No files in <code>/paths</code> yet. Drop a <code>.yaml</code> file there, or upload
              one.
            </p>
          ) : (
            <ul className="path-list">
              {paths.data.map((p) => (
                <li key={p.file} className={`path-item card${p.valid ? "" : " invalid"}`}>
                  <button
                    type="button"
                    disabled={!p.valid}
                    aria-label={p.valid ? `Load ${p.title}` : `${p.file} is invalid`}
                    onClick={() =>
                      p.valid &&
                      setChoice({
                        source: { file: p.file },
                        title: p.title ?? p.file,
                        startWeekday: p.startWeekday as Weekday | undefined,
                      })
                    }
                  >
                    <span className="path-title">{p.valid ? p.title : p.file}</span>
                    <span className="mono">
                      {p.file}
                      {p.version ? ` · ${p.version}` : ""}
                      {p.valid ? ` · ${p.taskCount} tasks` : ""}
                    </span>
                    <span className={`tag mono ${p.valid ? "ok" : "bad"}`}>
                      {p.valid ? "valid" : `${p.issues?.length ?? 0} problems`}
                    </span>
                  </button>
                  {!p.valid && p.issues && <IssueList issues={p.issues} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="upload-title">
          <h2 id="upload-title" className="section-title">
            Upload a file
          </h2>
          <label className="pill upload">
            Choose a .yaml file
            <input
              type="file"
              accept=".yaml,.yml"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onFile(f);
              }}
            />
          </label>
          {upload && (
            <div className="error" role="alert">
              <p>
                {upload.name} has {upload.issues.length} problem
                {upload.issues.length === 1 ? "" : "s"}.
              </p>
              <IssueList issues={upload.issues} />
            </div>
          )}
        </section>

        <section aria-labelledby="restore-title">
          <h2 id="restore-title" className="section-title">
            Restore from backup
          </h2>
          <RestoreFileButton label="Choose a backup…" />
        </section>
      </div>

      {choice && (
        <StartDateDialog
          title={choice.title}
          startWeekday={choice.startWeekday}
          pending={create.isPending}
          error={createError}
          onConfirm={confirm}
          onCancel={() => {
            setChoice(null);
            create.reset();
          }}
        />
      )}
    </>
  );
}
