/** Backup download and restore requests (spec §8.3, §9.2, §10). */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  backupFilename,
  daysBetween,
  localToday,
  type AppInfo,
  type RestorePreviewResponse,
} from "@learning-tracker/core";
import { api, ApiError } from "../api";
import { keys } from "../queries";

/**
 * Fetch the Backup and hand it to the browser as a download. The server sets `lastBackupAt`
 * once the response is sent, so `['app']` is refetched afterwards for the hint.
 */
export async function downloadBackup(today: string): Promise<void> {
  const res = await fetch(`/api/backup?today=${today}`);
  if (!res.ok) {
    const err = (
      (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null
    )?.error;
    throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? "Backup failed");
  }
  const blob = await res.blob();
  // jsdom and very old browsers lack object URLs; the request itself is what the server records.
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFilename(today);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function useDownloadBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: downloadBackup,
    onSettled: () => qc.invalidateQueries({ queryKey: keys.app }),
  });
}

export const useRestorePreview = () =>
  useMutation({
    mutationFn: (body: { backup: string; today: string }) =>
      api<RestorePreviewResponse>("POST", "/api/restore/preview", body),
  });

/** Server-confirmed. A restore replaces everything, so the whole cache is dropped (spec §10). */
export function useRestoreApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      backup: string;
      expectedSourceHash: string;
      expectedStateVersion: number;
    }) => api<AppInfo>("POST", "/api/restore", body),
    onSuccess: async (app) => {
      qc.removeQueries({ type: "inactive" });
      await qc.resetQueries();
      qc.setQueryData(keys.app, app);
    },
  });
}

/** "today", "1 day ago", "N days ago" or "never", by local calendar date (spec §7.1). */
export function lastBackupHint(lastBackupAt: string | null, today: string): string {
  if (!lastBackupAt) return "never";
  const days = daysBetween(localToday(new Date(lastBackupAt)), today);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
