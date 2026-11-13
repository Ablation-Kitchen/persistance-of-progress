/** Server state (spec §10): TanStack Query is the only global store. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppInfo,
  CreateEnrollmentBody,
  EnrollmentSummary,
  PathFile,
  Snapshot,
  TaskStateRecord,
  TaskStateResponse,
  TaskStatus,
} from "@learning-tracker/core";
import { api } from "./api";
import { useToast } from "./toast";

export const keys = {
  app: ["app"] as const,
  paths: ["paths"] as const,
  enrollments: ["enrollments"] as const,
  enrollment: (id: string) => ["enrollment", id] as const,
  notes: (id: string) => ["notes", id] as const,
};

export const useApp = () =>
  useQuery({ queryKey: keys.app, queryFn: () => api<AppInfo>("GET", "/api/app") });

/** Refetches on focus and every 60 s while the tab is visible (spec §8.5). */
export const usePaths = () =>
  useQuery({
    queryKey: keys.paths,
    queryFn: () => api<PathFile[]>("GET", "/api/paths"),
    refetchOnWindowFocus: "always",
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

export const useEnrollments = () =>
  useQuery({
    queryKey: keys.enrollments,
    queryFn: () => api<EnrollmentSummary[]>("GET", "/api/enrollments"),
  });

export const useEnrollment = (id: string | null | undefined) =>
  useQuery({
    queryKey: keys.enrollment(id ?? ""),
    queryFn: () => api<Snapshot>("GET", `/api/enrollments/${id}`),
    enabled: !!id,
  });

/** Server-confirmed: the new snapshot replaces the cache and becomes active. */
export function useCreateEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEnrollmentBody) => api<Snapshot>("POST", "/api/enrollments", body),
    onSuccess: async (snapshot) => {
      qc.setQueryData(keys.enrollment(snapshot.id), snapshot);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.app }),
        qc.invalidateQueries({ queryKey: keys.enrollments }),
      ]);
    },
  });
}

export function useSetActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enrollmentId: string | null) =>
      api<AppInfo>("PUT", "/api/app/active", { enrollmentId }),
    onSuccess: async (app) => {
      qc.setQueryData(keys.app, app);
      await qc.invalidateQueries({ queryKey: keys.app });
    },
  });
}

export function useDeleteEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/enrollments/${id}`),
    onSuccess: async (_, id) => {
      qc.removeQueries({ queryKey: keys.enrollment(id) });
      qc.removeQueries({ queryKey: keys.notes(id) });
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.app }),
        qc.invalidateQueries({ queryKey: keys.enrollments }),
      ]);
    },
  });
}

/** Replace (or add) one Task's record; `null` removes it (back to the implicit `todo`). */
function withRecord(s: Snapshot, taskId: string, record: TaskStateRecord | null): Snapshot {
  const rest = s.taskStates.filter((r) => r.taskId !== taskId);
  return { ...s, taskStates: record ? [...rest, record] : rest };
}

export interface TaskStateChange {
  taskId: string;
  status: TaskStatus;
  /** Ignored (sent as `null`) for `todo`. */
  statusDate: string;
}

/**
 * A single-Task status change is optimistic (spec §10): the snapshot is patched at once, the
 * response's record and `stateVersion` are merged in, and an error rolls the Task back with a
 * toast.
 */
export function useSetTaskState(enrollmentId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = keys.enrollment(enrollmentId);
  return useMutation({
    mutationFn: ({ taskId, status, statusDate }: TaskStateChange) =>
      api<TaskStateResponse>(
        "PUT",
        `/api/enrollments/${enrollmentId}/tasks/${encodeURIComponent(taskId)}/state`,
        { status, statusDate: status === "todo" ? null : statusDate },
      ),
    onMutate: async ({ taskId, status, statusDate }) => {
      await qc.cancelQueries({ queryKey: key });
      const current = qc.getQueryData<Snapshot>(key);
      const previous = current?.taskStates.find((r) => r.taskId === taskId) ?? null;
      const optimistic: TaskStateRecord = {
        taskId,
        status,
        statusDate: status === "todo" ? null : statusDate,
        offsetDays: previous?.offsetDays ?? 0,
        updatedAt: new Date().toISOString(),
      };
      qc.setQueryData<Snapshot>(key, (s) => s && withRecord(s, taskId, optimistic));
      return { previous, optimistic };
    },
    onError: (_err, { taskId }, ctx) => {
      // Roll back only if no later change to this Task has replaced ours.
      qc.setQueryData<Snapshot>(key, (s) => {
        const now = s?.taskStates.find((r) => r.taskId === taskId);
        return s && ctx && now === ctx.optimistic ? withRecord(s, taskId, ctx.previous) : s;
      });
      toast("Couldn't save, try again");
    },
    onSuccess: ({ record, stateVersion }, _vars, ctx) => {
      qc.setQueryData<Snapshot>(key, (s) => {
        if (!s) return s;
        const now = s.taskStates.find((r) => r.taskId === record.taskId);
        const next = now === ctx?.optimistic ? withRecord(s, record.taskId, record) : s;
        return { ...next, stateVersion: Math.max(s.stateVersion, stateVersion) };
      });
    },
  });
}
