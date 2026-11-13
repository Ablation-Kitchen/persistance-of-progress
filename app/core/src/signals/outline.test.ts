import { describe, expect, it } from "vitest";
import { addDays } from "../dates/dates.js";
import { applyShift, FIXTURE_START, scenario } from "../testing/scenarios.js";
import { isOptionalPast, pathOutline } from "./outline.js";
import { blockSignals, currentBlockIndex, dayNumber, taskViews } from "./signals.js";

describe("pathOutline", () => {
  it("week 4 after +2 with 2 tombstones: one marker, one moved note per affected week", () => {
    const { snapshot, today } = scenario("week4Shifted");
    const outline = pathOutline(snapshot, today);
    const weeks = outline.flatMap((b) => b.weeks);

    // The shift was applied today (day 24, week 4): its marker shows exactly once, in week 4.
    const marked = weeks.filter((w) => w.shifts.length > 0);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.week).toBe(4);
    expect(marked[0]!.shifts[0]!.days).toBe(2);

    // Every week holding a moved Task reports +2 once; weeks without moved Tasks report nothing.
    for (const w of weeks) {
      const moved = w.tasks.some((v) => v.offsetDays > 0);
      expect(w.movedBy).toEqual(moved ? [2] : []);
    }
    expect(weeks.filter((w) => w.movedBy.length).length).toBeGreaterThan(5);

    // Tombstoned Tasks are gone; every live Task appears once, under its own Block.
    const ids = weeks.flatMap((w) => w.tasks.map((v) => v.task.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(taskViews(snapshot, today).length);
    for (const s of snapshot.tombstones) expect(ids).not.toContain(s.taskId);
    for (const b of outline)
      for (const w of b.weeks) for (const v of w.tasks) expect(v.blockIndex).toBe(b.blockIndex);
  });

  it("Block 2 is current; signals and the this-week tag follow §5", () => {
    const { snapshot, today } = scenario("week4");
    const outline = pathOutline(snapshot, today);
    expect(currentBlockIndex(snapshot, today)).toBe(1);
    expect(outline.map((b) => b.signals)).toEqual(blockSignals(snapshot, today));
    expect(outline[1]!.signals.state).toBe("current");
    const thisWeek = outline.flatMap((b) => b.weeks).filter((w) => w.thisWeek);
    expect(thisWeek.every((w) => w.week === 4)).toBe(true);
    expect(thisWeek.length).toBeGreaterThan(0);
    const w4 = thisWeek[0]!;
    expect(w4.firstDate).toBe(addDays(FIXTURE_START, 21));
    expect(w4.lastDate).toBe(addDays(FIXTURE_START, 27));
  });

  it("a shift applied in a week with no Tasks of its own still shows once", () => {
    const { snapshot, today } = scenario("week4");
    // Applied before day 1 (week 0): goes to the first outline week after it.
    applyShift(snapshot, 1, addDays(FIXTURE_START, -10), "2026-09-01T00:00:00.000Z");
    const weeks = pathOutline(snapshot, today).flatMap((b) => b.weeks);
    expect(weeks.filter((w) => w.shifts.length)).toHaveLength(1);
    expect(weeks.find((w) => w.shifts.length)!.week).toBe(1);
  });

  it("optional past: optional, todo and past its effective due day", () => {
    const { snapshot, today } = scenario("week4");
    const t = dayNumber(snapshot, today);
    const past = taskViews(snapshot, today).filter((v) => isOptionalPast(v, t));
    expect(past.length).toBeGreaterThan(0);
    for (const v of past) {
      expect(v.optional && v.status === "todo" && v.effDue < t).toBe(true);
      expect(v.overdue).toBe(false);
    }
  });
});
