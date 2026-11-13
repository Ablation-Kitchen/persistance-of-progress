/**
 * Backup and restore in the UI (spec §7.1, §7.2, §9.2): the app-menu items with the "last
 * backup" hint, the restore file picker (also on the empty state) and the preview → confirm
 * dialog. One provider owns the dialog so it outlives the menu.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { BackupSummary } from "@learning-tracker/core";
import { ApiError } from "../api";
import { IssueList } from "../enroll/IssueList";
import { useApp } from "../queries";
import { useToast } from "../toast";
import { useToday } from "../today";
import { lastBackupHint, useDownloadBackup, useRestoreApply, useRestorePreview } from "./api";

interface Picked {
  name: string;
  text: string;
}

const RestoreContext = createContext<(file: Picked) => void>(() => {});

export function RestoreFlowProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  return (
    <RestoreContext.Provider value={setPicked}>
      {children}
      {picked && (
        <RestoreDialog key={picked.text} picked={picked} onClose={() => setPicked(null)} />
      )}
    </RestoreContext.Provider>
  );
}

/** A file input styled as a pill; picking a file opens the restore preview. */
export function RestoreFileButton({
  label,
  className = "pill",
  onOpen,
}: {
  label: string;
  className?: string;
  onOpen?: (() => void) | undefined;
}) {
  const open = useContext(RestoreContext);
  return (
    <label className={`${className} upload`}>
      {label}
      <input
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          onOpen?.();
          void f.text().then((text) => open({ name: f.name, text }));
        }}
      />
    </label>
  );
}

/** Backup, Restore and the hint, for the app menu. */
export function BackupMenuItems({ onOpen }: { onOpen?: () => void }) {
  const app = useApp();
  const today = useToday();
  const download = useDownloadBackup();
  const toast = useToast();
  return (
    <div className="backup-menu">
      <p className="mono">
        backup · last backup: {lastBackupHint(app.data?.lastBackupAt ?? null, today)}
      </p>
      <div className="row">
        <button
          type="button"
          className="pill sm"
          disabled={download.isPending}
          onClick={() =>
            download.mutate(today, { onError: () => toast("Couldn't make the backup, try again") })
          }
        >
          {download.isPending ? "Preparing…" : "Download backup"}
        </button>
        <RestoreFileButton label="Restore…" className="pill sm" onOpen={onOpen} />
      </div>
    </div>
  );
}

function Column({ title, summary }: { title: string; summary: BackupSummary }) {
  return (
    <section className="restore-col" aria-label={title}>
      <h3 className="mono">{title}</h3>
      {summary.enrollments.length === 0 ? (
        <p className="hint">No enrollments.</p>
      ) : (
        <ul>
          {summary.enrollments.map((e) => (
            <li key={e.id}>
              <span className="path-title">{e.title}</span>
              {e.active && <span className="tag mono">active</span>}
              <span className="mono">
                from {e.startDate} · {e.percent === null ? "—" : `${e.percent}%`} ·{" "}
                {e.notes === 1 ? "1 note" : `${e.notes} notes`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

function RestoreDialog({ picked, onClose }: { picked: Picked; onClose: () => void }) {
  const today = useToday();
  const preview = useRestorePreview();
  const apply = useRestoreApply();
  const toast = useToast();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const runPreview = preview.mutate;

  useEffect(() => runPreview({ backup: picked.text, today }), [runPreview, picked.text, today]);

  const data = preview.data;
  const error = (apply.error ?? preview.error) as ApiError | Error | null;
  const stale = error instanceof ApiError && error.code === "preview-stale";

  const confirm = () => {
    if (!data) return;
    apply.mutate(
      {
        backup: picked.text,
        expectedSourceHash: data.sourceHash,
        expectedStateVersion: data.stateVersion,
      },
      {
        onSuccess: () => {
          toast("Backup restored");
          onClose();
          void navigate("/today");
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === "preview-stale") {
            setNotice(
              "Something changed since this preview, so it was refreshed. Review it again.",
            );
            apply.reset();
            runPreview({ backup: picked.text, today });
          }
        },
      },
    );
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="dialog card restore-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <p className="mono">restore from {picked.name}</p>
        <h2 id="restore-dialog-title" className="serif">
          Restore this backup?
        </h2>
        {notice && (
          <p className="reload-notice" role="alert">
            {notice}
          </p>
        )}
        {preview.isPending && <p className="mono">reading the backup…</p>}
        {error && !stale && (
          <div className="error" role="alert">
            <p>{error.message}</p>
            {error instanceof ApiError && error.issues.length > 0 && (
              <IssueList issues={error.issues} />
            )}
          </div>
        )}
        {data && (
          <>
            <p className="hint">
              Backup made {when(data.summary.backup.exportedAt)} by version{" "}
              {data.summary.backup.appVersion}.
            </p>
            <div className="restore-compare">
              <Column title="In the backup" summary={data.summary.backup} />
              <Column title="Here now" summary={data.summary.current} />
            </div>
            <p className="hint">
              Restoring replaces everything here. The server keeps a Safety Copy of the current data
              first.
            </p>
          </>
        )}
        <div className="row end">
          <button type="button" className="pill" onClick={onClose}>
            {error && !stale ? "Close" : "Cancel"}
          </button>
          {data && (
            <button
              type="button"
              className="pill solid"
              disabled={apply.isPending || preview.isPending}
              onClick={confirm}
            >
              {apply.isPending ? "Restoring…" : "Restore"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
