/** Server state (spec §10): TanStack Query is the only global store. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppInfo,
  CreateEnrollmentBody,
  EnrollmentSummary,
  PathFile,
  Snapshot,
} from "@learning-tracker/core";
import { api } from "./api";

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
