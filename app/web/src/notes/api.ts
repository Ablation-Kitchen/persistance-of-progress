/** Note server state (spec §10): `['notes', id]` holds the bodies, the snapshot the metadata. */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type {
  DeleteNoteResponse,
  ErrorResponse,
  NoteBody,
  PutNoteBody,
  PutNoteResponse,
  Snapshot,
} from "@learning-tracker/core";
import { api, ApiError } from "../api";
import { keys } from "../queries";

export const noteUrl = (enrollmentId: string, target: string) =>
  `/api/enrollments/${enrollmentId}/notes/${encodeURIComponent(target)}`;

export const useNotes = (enrollmentId: string | null | undefined) =>
  useQuery({
    queryKey: keys.notes(enrollmentId ?? ""),
    queryFn: () => api<NoteBody[]>("GET", `/api/enrollments/${enrollmentId}/notes`),
    enabled: !!enrollmentId,
  });

/**
 * Save a Note's whole body. `keepalive` lets the request outlive the page, for the flush on
 * `pagehide` / `visibilitychange` (spec §10).
 */
export async function putNote(
  enrollmentId: string,
  target: string,
  body: PutNoteBody,
  keepalive = false,
): Promise<PutNoteResponse> {
  const res = await fetch(noteUrl(enrollmentId, target), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as ErrorResponse | null)?.error;
    throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? "save failed");
  }
  return json as PutNoteResponse;
}

export const deleteNote = (enrollmentId: string, target: string) =>
  api<DeleteNoteResponse>("DELETE", noteUrl(enrollmentId, target));

/** Patch both caches from a save's response. */
export function applySaved(
  qc: QueryClient,
  enrollmentId: string,
  body: string,
  { meta, stateVersion }: PutNoteResponse,
) {
  qc.setQueryData<NoteBody[]>(
    keys.notes(enrollmentId),
    (list) =>
      list && [...list.filter((n) => n.target !== meta.target), { target: meta.target, body }],
  );
  qc.setQueryData<Snapshot>(
    keys.enrollment(enrollmentId),
    (s) =>
      s && {
        ...s,
        noteMeta: [...s.noteMeta.filter((m) => m.target !== meta.target), meta],
        stateVersion: Math.max(s.stateVersion, stateVersion),
      },
  );
}

export function applyDeleted(
  qc: QueryClient,
  enrollmentId: string,
  target: string,
  { stateVersion }: DeleteNoteResponse,
) {
  qc.setQueryData<NoteBody[]>(
    keys.notes(enrollmentId),
    (list) => list && list.filter((n) => n.target !== target),
  );
  qc.setQueryData<Snapshot>(
    keys.enrollment(enrollmentId),
    (s) =>
      s && {
        ...s,
        noteMeta: s.noteMeta.filter((m) => m.target !== target),
        stateVersion: Math.max(s.stateVersion, stateVersion),
      },
  );
}
