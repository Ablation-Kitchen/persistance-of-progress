import type { IssueJson as Issue } from "@learning-tracker/core";

export function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="issues" aria-label="Problems">
      {issues.map((i, n) => (
        <li key={n}>
          <span className="mono">
            {i.line !== undefined
              ? `line ${i.line}${i.column !== undefined ? `:${i.column}` : ""}`
              : i.pointer || "/"}
            {" · "}
            {i.rule}
          </span>{" "}
          {i.message}
        </li>
      ))}
    </ul>
  );
}
