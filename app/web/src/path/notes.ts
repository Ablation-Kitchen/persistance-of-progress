import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { keys } from "../queries";

/**
 * Note bodies (`['notes', id]`, spec §10), for the excerpts of removed Tasks. The route arrives
 * with ticket 08; until then the query fails quietly and rows show "has a note".
 * TODO(merge with 08): replace with 08's notes query if it defines one under the same key.
 */
export const useNoteBodies = (enrollmentId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.notes(enrollmentId),
    queryFn: () =>
      api<{ target: string; body: string }[]>("GET", `/api/enrollments/${enrollmentId}/notes`),
    enabled,
    retry: false,
  });
