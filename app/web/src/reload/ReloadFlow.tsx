/**
 * Reload (spec §6, §8.4, §8.5): the changed-file banner, the "Reload path…" picker in the app
 * menu, and the preview → confirm dialog. One provider owns the dialogs so they outlive the menu.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  addedOverdueCount,
  isEmptyDiff,
  type PathSource,
  type ReloadDiff,
  type Snapshot,
} from "@learning-tracker/core";
import { ApiError } from "../api";
import { IssueList } from "../enroll/IssueList";
import { useApp, useEnrollment, usePaths } from "../queries";
import { useToast } from "../toast";
import { useToday } from "../today";
import { useReloadApply, useReloadPreview } from "./api";

type Flow = { step: "pick" } | { step: "preview"; source: PathSource; label: string } | null;

interface ReloadFlowApi {
  openPicker: () => void;
  openPreview: (source: PathSource, label: string) => void;
}

const ReloadContext = createContext<ReloadFlowApi>({ openPicker: () => {}, openPreview: () => {} });
export const useReloadFlow = () => useContext(ReloadContext);

export function ReloadFlowProvider({ children }: { children: ReactNode }) {
  const [flow, setFlow] = useState<Flow>(null);
  const app = useApp();
  const snapshot = useEnrollment(app.data?.activeEnrollmentId).data;
  const close = () => setFlow(null);
  const value: ReloadFlowApi = {
    openPicker: () => setFlow({ step: "pick" }),
    openPreview: (source, label) => setFlow({ step: "preview", source, label }),
  };
  return (
    <ReloadContext.Provider value={value}>
      {children}
      {snapshot && flow?.step === "pick" && (
        <ReloadPicker snapshot={snapshot} onPick={value.openPreview} onClose={close} />
      )}
      {snapshot && flow?.step === "preview" && (
        <ReloadPreviewDialog
          key={JSON.stringify(flow.source)}
          snapshot={snapshot}
          source={flow.source}
          label={flow.label}
          onClose={close}
        />
      )}
    </ReloadContext.Provider>
  );
}

/** `/paths` files with the active Enrollment's path id. */
function useMatchingFiles(snapshot: Snapshot | undefined) {
  const files = usePaths().data ?? [];
  return snapshot ? files.filter((f) => f.valid && f.pathId === snapshot.pathId) : [];
}

/**
 * Shown when a valid `/paths` file has the active Enrollment's path id and a different hash
 * (decided client-side; uploads never get one).
 */
export function ReloadBanner() {
  const app = useApp();
  const snapshot = useEnrollment(app.data?.activeEnrollmentId).data;
  const changed = useMatchingFiles(snapshot).filter((f) => f.hash !== snapshot?.pathHash);
  const { openPreview } = useReloadFlow();
  if (!snapshot || changed.length === 0) return null;
  return (
    <div className="reload-banner" role="status">
      <div className="wrap row">
        <span className="dot" aria-hidden="true" />
        <span>
          {changed.length === 1
            ? "The path file has changed"
            : `${changed.length} files for this path have changed — pick one`}
        </span>
        {changed.map((f) => (
          <button
            key={f.file}
            type="button"
            className="pill sm"
            onClick={() => openPreview({ file: f.file }, f.file)}
          >
            {changed.length === 1 ? "Review reload" : `Review ${f.file}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The app-menu item. */
export function ReloadMenuItem({ onOpen }: { onOpen?: () => void }) {
  const app = useApp();
  const { openPicker } = useReloadFlow();
  if (!app.data?.activeEnrollmentId) return null;
  return (
    <button
      type="button"
      className="pill sm"
      onClick={() => {
        onOpen?.();
        openPicker();
      }}
    >
      Reload path…
    </button>
  );
}

function Dialog({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="dialog card reload-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reload-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <p className="mono">{eyebrow}</p>
        <h2 id="reload-title" className="serif">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function ReloadPicker({
  snapshot,
  onPick,
  onClose,
}: {
  snapshot: Snapshot;
  onPick: (source: PathSource, label: string) => void;
  onClose: () => void;
}) {
  const files = useMatchingFiles(snapshot);
  return (
    <Dialog title="Reload the path" eyebrow={snapshot.path.title} onClose={onClose}>
      <p className="hint">
        Pick the edited file. You&apos;ll see every change before anything is saved.
      </p>
      {files.length > 0 ? (
        <ul className="reload-files">
          {files.map((f) => (
            <li key={f.file}>
              <button
                type="button"
                className="pill sm"
                onClick={() => onPick({ file: f.file }, f.file)}
              >
                {f.file}
              </button>{" "}
              <span className="mono">
                {f.hash === snapshot.pathHash ? "same as loaded" : "changed"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mono">no file in /paths has this path&apos;s id</p>
      )}
      <label className="pill sm upload">
        Upload a .yaml file
        <input
          type="file"
          accept=".yaml,.yml"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then((yaml) => onPick({ filename: f.name, yaml }, f.name));
          }}
        />
      </label>
      <div className="row end">
        <button type="button" className="pill" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ReloadPreviewDialog({
  snapshot,
  source,
  label,
  onClose,
}: {
  snapshot: Snapshot;
  source: PathSource;
  label: string;
  onClose: () => void;
}) {
  const preview = useReloadPreview(snapshot.id);
  const apply = useReloadApply(snapshot.id);
  const toast = useToast();
  const [notice, setNotice] = useState<string | null>(null);
  const runPreview = preview.mutate;

  useEffect(() => runPreview(source), [runPreview, source]);

  const data = preview.data;
  const error = (apply.error ?? preview.error) as ApiError | Error | null;
  const unchanged = data && ("unchanged" in data || isEmptyDiff(data.diff));

  const confirm = () => {
    if (!data || "unchanged" in data) return;
    apply.mutate(
      { source, expectedSourceHash: data.sourceHash, expectedStateVersion: data.stateVersion },
      {
        onSuccess: () => {
          toast("Path reloaded");
          onClose();
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === "preview-stale") {
            setNotice(
              "Something changed since this preview, so it was refreshed. Review it again.",
            );
            apply.reset();
            runPreview(source);
          }
        },
      },
    );
  };

  return (
    <Dialog title="Review reload" eyebrow={`reload from ${label}`} onClose={onClose}>
      {notice && (
        <p className="reload-notice" role="alert">
          {notice}
        </p>
      )}
      {preview.isPending && <p className="mono">reading the file…</p>}
      {error && !(error instanceof ApiError && error.code === "preview-stale") && (
        <div className="error" role="alert">
          <p>{error.message}</p>
          {error instanceof ApiError && error.issues.length > 0 && (
            <IssueList issues={error.issues} />
          )}
        </div>
      )}
      {unchanged && <p>No changes. The file matches the loaded path.</p>}
      {data && "diff" in data && !unchanged && <DiffView snapshot={snapshot} diff={data.diff} />}
      <div className="row end">
        <button type="button" className="pill" onClick={onClose}>
          {unchanged || error ? "Close" : "Cancel"}
        </button>
        {data && !unchanged && !(error && !(error instanceof ApiError)) && (
          <button
            type="button"
            className="pill solid"
            disabled={apply.isPending || preview.isPending}
            onClick={confirm}
          >
            {apply.isPending ? "Reloading…" : "Reload"}
          </button>
        )}
      </div>
    </Dialog>
  );
}

function DiffView({ snapshot, diff }: { snapshot: Snapshot; diff: ReloadDiff }) {
  const today = useToday();
  const overdue = addedOverdueCount(snapshot, diff, today);
  const hidden = diff.removed.filter((r) => r.keptHidden).length;
  return (
    <div className="reload-diff">
      <p className="reload-summary">
        {[
          diff.added.length > 0 && `${diff.added.length} added, ${overdue} already overdue`,
          diff.removed.length > 0 && `${plural(diff.removed.length, "removed")}`,
          hidden > 0 && `${plural(hidden, "removed task")} will be kept hidden`,
          diff.restored.length > 0 && `${diff.restored.length} restored`,
          diff.moved.length > 0 && `${diff.moved.length} moved`,
          diff.changed.length > 0 && `${diff.changed.length} changed`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <Section title="Added" n={diff.added.length}>
        {diff.added.map((a) => (
          <li key={a.taskId}>
            {a.title} <span className="mono">day {a.day}</span>
          </li>
        ))}
      </Section>
      <Section title="Removed" n={diff.removed.length}>
        {diff.removed.map((r) => (
          <li key={r.taskId}>
            {r.title} <span className="mono">was day {r.formerDay}</span>
            {r.keptHidden && <span className="tag">will be kept hidden</span>}
          </li>
        ))}
      </Section>
      <Section title="Restored" n={diff.restored.length}>
        {diff.restored.map((r) => (
          <li key={r.taskId}>{r.title}</li>
        ))}
      </Section>
      <Section title="Moved" n={diff.moved.length}>
        {diff.moved.map((m) => (
          <li key={m.taskId}>
            {m.title}{" "}
            <span className="mono">
              {span(m.from)} → {span(m.to)}
            </span>
          </li>
        ))}
      </Section>
      <Section title="Changed" n={diff.changed.length}>
        {diff.changed.map((c) => (
          <li key={c.taskId}>
            {c.title} <span className="mono">{c.fields.join(", ")}</span>
          </li>
        ))}
      </Section>
      <Section title="Path" n={diff.pathChanges.length}>
        {diff.pathChanges.map((p, i) => (
          <li key={i}>
            <span className="mono">{p.field}</span> {p.detail}
          </li>
        ))}
      </Section>
    </div>
  );
}

const span = (d: { day: number; dueDay: number }) =>
  d.dueDay === d.day ? `day ${d.day}` : `days ${d.day}–${d.dueDay}`;

function Section({ title, n, children }: { title: string; n: number; children: ReactNode }) {
  if (n === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="mono">
        {title} · {n}
      </h3>
      <ul>{children}</ul>
    </section>
  );
}
