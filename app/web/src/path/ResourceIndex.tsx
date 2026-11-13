import { useState } from "react";
import {
  byFirstUse,
  byTitle,
  resourceIndex,
  resourceMatches,
  resourcePasses,
  type ResourceEntry,
  type ResourceFilter,
  type Snapshot,
} from "@learning-tracker/core";

type Order = "first" | "block" | "az";

const FILTERS: [ResourceFilter, string][] = [
  ["all", "all"],
  ["core", "core"],
  ["books", "books"],
  ["todo", "still to use"],
];
const ORDERS: [Order, string][] = [
  ["first", "first use"],
  ["block", "by block"],
  ["az", "a–z"],
];

interface Props {
  snapshot: Snapshot;
  today: string;
  /** Open a Task in the Outline (a use chip was clicked). */
  onJump: (taskId: string) => void;
}

/** The Resource Index side column of the Path screen (spec §7.4). */
export function ResourceIndex({ snapshot, today, onJump }: Props) {
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [order, setOrder] = useState<Order>("first");
  const [query, setQuery] = useState("");

  const all = resourceIndex(snapshot, today);
  const shown = all.filter((e) => resourcePasses(e, filter) && resourceMatches(e, query));
  const coreCount = snapshot.path.resources?.length ?? 0;
  const linkCount = snapshot.path.blocks
    .flatMap((b) => b.tasks)
    .reduce((n, t) => n + (t.links?.length ?? 0), 0);

  const list = (entries: ResourceEntry[]) => (
    <ul className="res-list">
      {entries.map((e) => (
        <Entry key={e.key} e={e} onJump={onJump} />
      ))}
    </ul>
  );

  let body;
  if (shown.length === 0) {
    body = (
      <p className="mono res-none">no resources match{query.trim() ? ` “${query.trim()}”` : ""}</p>
    );
  } else if (order === "block") {
    const whole = shown.filter((e) => e.blockIndex === null);
    body = (
      <>
        {whole.length > 0 && (
          <section aria-label="Whole path">
            <p className="grp mono">whole path · not linked from a task</p>
            {list(whole)}
          </section>
        )}
        {snapshot.path.blocks.map((b, i) => {
          const group = shown.filter((e) => e.blockIndex === i).sort(byFirstUse);
          if (group.length === 0) return null;
          return (
            <section key={i} aria-label={b.title}>
              <p className="grp mono">
                {String(i + 1).padStart(2, "0")} · {b.title} · {group.length}
              </p>
              {list(group)}
            </section>
          );
        })}
      </>
    );
  } else {
    body = list([...shown].sort(order === "az" ? byTitle : byFirstUse));
  }

  return (
    <div className="res-index">
      <div className="res-head">
        <h2 className="serif">Resources</h2>
        <span className="mono">
          {shown.length === all.length
            ? `${all.length} entries`
            : `${shown.length} of ${all.length}`}{" "}
          · from {coreCount} core + {linkCount} task links
        </span>
      </div>
      <input
        type="search"
        className="res-search"
        aria-label="Search resources"
        placeholder="Search resources and the tasks that use them"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="chips res-chips" role="group" aria-label="Filter resources">
        <span className="mono">show</span>
        {FILTERS.map(([k, label]) => (
          <button
            type="button"
            key={k}
            className={`pill sm${filter === k ? " on" : ""}`}
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="chips res-chips" role="group" aria-label="Order resources">
        <span className="mono">order</span>
        {ORDERS.map(([k, label]) => (
          <button
            type="button"
            key={k}
            className={`pill sm${order === k ? " on" : ""}`}
            aria-pressed={order === k}
            onClick={() => setOrder(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}

function Entry({ e, onJump }: { e: ResourceEntry; onJump: (taskId: string) => void }) {
  return (
    <li className="res-entry" data-key={e.key}>
      <div className="res-title">
        {e.url ? (
          <a href={e.url} target="_blank" rel="noopener noreferrer">
            {e.title} ↗
          </a>
        ) : (
          <>
            {e.title} <span className="tag">book</span>
          </>
        )}
        {e.isCore && (
          <>
            {" "}
            <span className="tag core">core</span>
          </>
        )}
      </div>
      {e.note && <p className="mono res-note">{e.note}</p>}
      {e.otherSpellings.length > 0 && (
        <p className="mono res-alias">
          also listed as {e.otherSpellings.map((s) => `“${s}”`).join(", ")}
        </p>
      )}
      {e.uses.length > 0 ? (
        <div className="res-uses">
          {e.uses.map((u) => (
            <button
              type="button"
              key={u.taskId}
              className={`use${u.done ? " done" : ""}`}
              title={u.title}
              aria-label={`day ${u.effDay}: ${u.title}${u.done ? ", done" : ""}`}
              onClick={() => onJump(u.taskId)}
            >
              d{u.effDay}
              {u.done && " ✓"}
            </button>
          ))}
        </div>
      ) : (
        <p className="mono res-note">not linked from a task · whole-path reference</p>
      )}
    </li>
  );
}
