import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  formatDate,
  localToday,
  parseDate,
  weekday,
} from "../dates/dates.js";
import type { LearningPath, Task } from "../path/types.js";
import {
  applyShift,
  editNote,
  emptySnapshot,
  scenario,
  SCENARIO_DAY,
  setState,
  tombstone,
} from "../testing/scenarios.js";
import {
  blockSignals,
  dayNumber,
  runInfo,
  stats,
  taskViews,
  todayColumns,
  undoableShift,
  weekStrip,
} from "./signals.js";

const START = "2026-09-07"; // Monday
const date = (d: number) => addDays(START, d - 1);

/** A small path: one Block per `tasks` array. */
function pathOf(...blocks: Partial<Task>[][]): LearningPath {
  let n = 0;
  return {
    schemaVersion: 1,
    id: "mini",
    title: "Mini",
    description: "",
    weekRhythm: ["Study", "Build", "Study", "Build", "Review", "", ""],
    blocks: blocks.map((tasks, i) => ({
      title: `Block ${i + 1}`,
      goal: "",
      tasks: tasks.map((t) => ({
        id: `t${++n}`,
        day: 1,
        kind: "material" as const,
        title: `T${n}`,
        ...t,
      })),
    })),
  };
}

const view = (s: ReturnType<typeof emptySnapshot>, today: string, id: string) => {
  const v = taskViews(s, today).find((x) => x.task.id === id);
  if (!v) throw new Error(`no ${id}`);
  return v;
};

describe("dates", () => {
  it("round-trips and does arithmetic on day counts", () => {
    expect(formatDate(parseDate("2026-02-28") + 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-10-20", "2026-11-03")).toBe(14);
    expect(weekday("2026-09-07")).toBe(0);
    expect(weekday("2026-09-13")).toBe(6);
    expect(() => parseDate("2026-02-30")).toThrow(/calendar/);
    expect(() => parseDate("2026-2-3")).toThrow(/YYYY-MM-DD/);
  });

  it.each(["Europe/Berlin", "America/New_York"])("day number is right across DST in %s", (tz) => {
    const before = process.env.TZ;
    process.env.TZ = tz;
    try {
      // Europe leaves DST on 2026-10-25, the US on 2026-11-01.
      const s = emptySnapshot(pathOf([{}]), "2026-10-20");
      for (const [hhmm, expected] of [
        ["00:30", "2026-11-03"],
        ["23:30", "2026-11-03"],
      ] as const) {
        const local = new Date(2026, 10, 3, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)));
        const today = localToday(local);
        expect(today).toBe(expected);
        expect(dayNumber(s, today)).toBe(15);
      }
      expect(dayNumber(s, localToday(new Date(2026, 9, 26, 0, 30)))).toBe(7);
    } finally {
      process.env.TZ = before;
    }
  });
});

describe("per Task", () => {
  const s = emptySnapshot(
    pathOf([
      { day: 2, dueDay: 4 },
      { day: 2, dueDay: 4, optional: true },
    ]),
  );

  it("a required Task with dueDay 4 is open on days 2–4 and overdue on day 5", () => {
    const at = (d: number) => view(s, date(d), "t1");
    expect([1, 2, 3, 4, 5].map((d) => at(d).open)).toEqual([false, true, true, true, false]);
    expect([1, 2, 3, 4, 5].map((d) => at(d).overdue)).toEqual([false, false, false, false, true]);
    expect(at(7).daysOverdue).toBe(3);
  });

  it("optional Tasks are never overdue", () => {
    expect(view(s, date(5), "t2").overdue).toBe(false);
    expect(view(s, date(50), "t2").overdue).toBe(false);
  });

  it("applies the offset and flags done late", () => {
    const c = structuredClone(s);
    setState(c, "t1", "done", date(5));
    c.taskStates[0]!.offsetDays = 2;
    const v = view(c, date(5), "t1");
    expect([v.effDay, v.effDue, v.effDate, v.effDueDate]).toEqual([4, 6, date(4), date(6)]);
    expect(v.doneLate).toBe(false);
    setState(c, "t1", "done", date(7));
    expect(view(c, date(8), "t1").doneLate).toBe(true);
  });
});

describe("stats", () => {
  it("percent ignores optional and tombstoned Tasks and counts skipped as not done", () => {
    const s = emptySnapshot(
      pathOf([{}, {}, {}, { optional: true }, { optional: true }, { kind: "checkpoint" }]),
    );
    setState(s, "t1", "done", date(1));
    setState(s, "t2", "skipped", date(1));
    setState(s, "t4", "done", date(1));
    setState(s, "t6", "done", date(1));
    tombstone(s, "t3", "2026-09-08T00:00:00Z");
    const st = stats(s, date(2));
    expect([st.requiredDone, st.required, st.percent]).toEqual([2, 3, 66]);
    expect(st.bonus).toBe(1);
    expect([st.checkpointsPassed, st.checkpoints]).toEqual([1, 1]);
  });

  it("percent is null without required Tasks", () => {
    expect(stats(emptySnapshot(pathOf([{ optional: true }])), date(1)).percent).toBeNull();
  });
});

describe("streak", () => {
  // Tasks on days 1–6; day 7 has nothing scheduled.
  const base = () => emptySnapshot(pathOf([1, 2, 3, 4, 5, 6, 8, 9].map((day) => ({ day }))));

  it("a day with a Note edit but no tick counts", () => {
    const s = base();
    setState(s, "t1", "done", date(1));
    editNote(s, `day:${date(2)}`, date(2));
    expect(stats(s, date(2)).streak).toBe(2);
  });

  it("a day with nothing scheduled and no activity is skipped", () => {
    const s = base();
    setState(s, "t6", "done", date(6));
    setState(s, "t7", "done", date(8));
    expect(stats(s, date(8)).streak).toBe(2);
  });

  it("today with no activity doesn't break it", () => {
    const s = base();
    setState(s, "t1", "done", date(1));
    setState(s, "t2", "done", date(2));
    expect(stats(s, date(3)).streak).toBe(2);
  });

  it("a scheduled day with no activity ends it", () => {
    const s = base();
    setState(s, "t1", "done", date(1));
    setState(s, "t3", "done", date(3));
    expect(stats(s, date(3)).streak).toBe(1);
    expect(stats(s, date(3)).longestStreak).toBe(1);
  });

  it("a Note edit on a tombstoned Task counts; skipped Tasks never do", () => {
    const s = base();
    setState(s, "t1", "done", date(1));
    tombstone(s, "t2", "2026-09-01T00:00:00Z");
    editNote(s, "task:t2", date(2));
    setState(s, "t3", "skipped", date(3));
    expect(stats(s, date(3)).streak).toBe(2);
    expect(stats(s, date(4)).streak).toBe(0);
  });

  it("longest streak survives a break", () => {
    const s = base();
    for (const d of [1, 2, 3]) setState(s, `t${d}`, "done", date(d));
    setState(s, "t5", "done", date(5));
    const st = stats(s, date(5));
    expect([st.streak, st.longestStreak]).toEqual([1, 3]);
  });
});

describe("Blocks", () => {
  it("tags complete, behind, current and upcoming", () => {
    const s = emptySnapshot(
      pathOf(
        [{ day: 1 }, { day: 2 }],
        [{ day: 3 }, { day: 4, optional: true }],
        [{ day: 5, dueDay: 7 }],
        [{ day: 9 }],
      ),
    );
    setState(s, "t1", "done", date(1));
    setState(s, "t2", "done", date(2));
    setState(s, "t3", "skipped", date(3));
    const tags = blockSignals(s, date(6)).map((b) => b.state);
    expect(tags).toEqual(["complete", "behind", "current", "upcoming"]);
    expect(stats(s, date(6)).blocksComplete).toBe(1);
    expect(blockSignals(s, date(8))[2]?.state).toBe("behind");
  });
});

describe("Today columns and strip", () => {
  it("splits Catch up / Today / In progress", () => {
    const s = emptySnapshot(
      pathOf([
        { day: 1 },
        { day: 2 },
        { day: 3, dueDay: 6 },
        { day: 5 },
        { day: 5, optional: true },
      ]),
    );
    const cols = todayColumns(s, date(5));
    expect(cols.catchUp.map((v) => v.task.id)).toEqual(["t1", "t2"]);
    expect(cols.today.map((v) => v.task.id)).toEqual(["t4", "t5"]);
    expect(cols.inProgress.map((v) => v.task.id)).toEqual(["t3"]);
  });

  it("strip dots reflect status", () => {
    const s = emptySnapshot(pathOf([{ day: 1 }, { day: 1 }, { day: 2 }, { day: 4 }]));
    setState(s, "t1", "done", date(1));
    setState(s, "t2", "skipped", date(1));
    const strip = weekStrip(s, date(3));
    expect(strip.map((d) => d.dots.map((x) => x.dot))).toEqual([
      ["done", "skipped"],
      ["overdue"],
      [],
      ["open"],
      [],
      [],
      [],
    ]);
    expect(strip[2]).toMatchObject({ isToday: true, rhythm: "Study", date: date(3) });
  });
});

describe("undoableShift", () => {
  it("the latest shift is undoable until a reload is newer than it", () => {
    const s = emptySnapshot(pathOf([{ day: 1 }]));
    applyShift(s, 1, date(1), "2026-09-07T10:00:00Z");
    const second = applyShift(s, 2, date(2), "2026-09-08T10:00:00Z");
    expect(undoableShift(s)?.id).toBe(second.id);

    s.reloadedAt = "2026-09-08T09:00:00Z";
    expect(undoableShift(s)?.id).toBe(second.id);

    s.reloadedAt = "2026-09-08T11:00:00Z";
    expect(undoableShift(s)).toBeNull();

    // Undo is a stack: dropping the latest exposes the previous one, under the same rule.
    s.reloadedAt = null;
    s.shifts.pop();
    expect(undoableShift(s)?.days).toBe(1);
    expect(undoableShift({ shifts: [], reloadedAt: null })).toBeNull();
  });
});

describe("fixture scenarios", () => {
  it("run length uses effective due days: +2 pushes the 17-week run to 18", () => {
    const plain = runInfo(scenario("week4").snapshot, scenario("week4").today);
    expect([plain.day, plain.length, plain.weeks, plain.week]).toEqual([24, 118, 17, 4]);
    const { snapshot, today } = scenario("week4Shifted");
    const shifted = runInfo(snapshot, today);
    expect([shifted.length, shifted.weeks]).toEqual([120, 18]);
    expect(snapshot.tombstones).toHaveLength(2);
    expect(undoableShift(snapshot)).not.toBeNull();
  });

  it("covers before the start, mid-run and after the end", () => {
    for (const name of Object.keys(SCENARIO_DAY) as (keyof typeof SCENARIO_DAY)[]) {
      const { snapshot, today } = scenario(name);
      const run = runInfo(snapshot, today);
      expect(run.day).toBe(SCENARIO_DAY[name]);
      expect(run.beforeStart).toBe(name === "beforeStart");
      expect(run.finished).toBe(name === "afterEnd");
      const st = stats(snapshot, today);
      expect(st.required).toBeGreaterThan(0);
      if (name === "beforeStart") expect([st.percent, st.streak]).toEqual([0, 0]);
    }
    const mid = scenario("week12");
    expect(todayColumns(mid.snapshot, mid.today).catchUp.length).toBeGreaterThan(0);
    expect(stats(mid.snapshot, mid.today).streak).toBeGreaterThan(0);
    const end = scenario("afterEnd");
    expect(blockSignals(end.snapshot, end.today).every((b) => b.state !== "upcoming")).toBe(true);
  });
});

describe("purity", () => {
  it("no core source reads the clock without an argument", () => {
    const root = new URL("../", import.meta.url).pathname;
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory()
          ? walk(p)
          : p.endsWith(".ts") && !p.endsWith(".test.ts")
            ? [p]
            : [];
      });
    })(root);
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.filter((f) =>
      /Date\.now\(|new Date\(\s*\)/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
