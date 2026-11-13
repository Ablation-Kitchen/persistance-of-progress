import type { Block, LearningPath, Task } from "./types.js";

export interface PlacedTask {
  task: Task;
  blockIndex: number;
  /** Position in the Block's `tasks` array. */
  taskIndex: number;
}

export function dueDayOf(task: Task): number {
  return task.dueDay ?? task.day;
}

/**
 * Every Task in path order: by `day`, then Block index, then array index (spec §3.1).
 * The file does not keep Tasks sorted by day, so this sort matters.
 */
export function allTasks(path: LearningPath): PlacedTask[] {
  const placed = path.blocks.flatMap((block, blockIndex) =>
    block.tasks.map((task, taskIndex) => ({ task, blockIndex, taskIndex })),
  );
  return placed.sort(
    (a, b) => a.task.day - b.task.day || a.blockIndex - b.blockIndex || a.taskIndex - b.taskIndex,
  );
}

/** N = the largest `dueDay ?? day` across all Tasks. */
export function pathLength(path: LearningPath): number {
  let n = 0;
  for (const block of path.blocks) n = Math.max(n, blockRange(block).last);
  return n;
}

/** A Block's range: its first `day` through its last due day. */
export function blockRange(block: Block): { first: number; last: number } {
  let first = Infinity;
  let last = -Infinity;
  for (const task of block.tasks) {
    first = Math.min(first, task.day);
    last = Math.max(last, dueDayOf(task));
  }
  return { first, last };
}
