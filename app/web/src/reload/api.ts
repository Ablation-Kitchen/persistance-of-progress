/** Reload requests (spec §6, §8.4). Both are server-confirmed; apply replaces the snapshot. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PathSource, ReloadPreviewResponse, Snapshot } from "@learning-tracker/core";
import { api } from "../api";
import { keys } from "../queries";

export function useReloadPreview(enrollmentId: string) {
  return useMutation({
    mutationFn: (source: PathSource) =>
      api<ReloadPreviewResponse>("POST", `/api/enrollments/${enrollmentId}/reload/preview`, {
        source,
      }),
  });
}

export function useReloadApply(enrollmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      source: PathSource;
      expectedSourceHash: string;
      expectedStateVersion: number;
    }) => api<Snapshot>("POST", `/api/enrollments/${enrollmentId}/reload`, body),
    onSuccess: async (snapshot) => {
      qc.setQueryData(keys.enrollment(snapshot.id), snapshot);
      await qc.invalidateQueries({ queryKey: keys.enrollments });
    },
  });
}
