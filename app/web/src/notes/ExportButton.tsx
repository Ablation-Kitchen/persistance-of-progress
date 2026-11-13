import { notesExportFilename, type Snapshot } from "@learning-tracker/core";

/**
 * Notes → Markdown (spec §9.1). A plain download link: the server answers with an attachment, so
 * the browser saves the file without leaving the page. `today` is the browser's local date.
 */
export function ExportButton({ snapshot, today }: { snapshot: Snapshot; today: string }) {
  const href = `/api/enrollments/${snapshot.id}/notes-export?today=${today}`;
  return (
    <a
      className="pill sm export-notes"
      href={href}
      download={notesExportFilename(snapshot, today)}
      title="Download every written Note as one Markdown file, by week"
    >
      Export .md
    </a>
  );
}
