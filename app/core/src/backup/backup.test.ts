import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api/snapshot.js";
import { pathHash } from "../path/hash.js";
import { stats } from "../signals/signals.js";
import { scenario } from "../testing/scenarios.js";
import {
  backupFilename,
  backupJson,
  backupSourceHash,
  backupSummary,
  buildBackup,
  snapshotFromBackup,
  validateBackup,
  type Backup,
  type BackupEnrollment,
} from "./backup.js";

/** A Backup entry for a scenario snapshot, with a body for each Note. */
function enrollmentOf(s: Snapshot): BackupEnrollment {
  return {
    id: s.id,
    createdAt: s.createdAt,
    startDate: s.startDate,
    loadedAt: s.loadedAt,
    reloadedAt: s.reloadedAt,
    path: s.path,
    pathHash: pathHash(s.path), // tombstoned scenarios edit the path copy
    taskStates: s.taskStates,
    shifts: s.shifts.map(({ appliedOn, days, taskIds, createdAt }) => ({
      appliedOn,
      days,
      taskIds,
      createdAt,
    })),
    notes: s.noteMeta.map((n) => ({
      target: n.target,
      body: `note on ${n.target}`,
      fromTemplate: n.fromTemplate,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      editedOn: n.editedOn,
    })),
    tombstones: s.tombstones,
  };
}

function week4Backup(): { backup: Backup; snapshot: Snapshot; today: string } {
  const { snapshot, today } = scenario("week4Shifted");
  const backup = buildBackup({
    exportedAt: "2026-09-30T12:00:00.000Z",
    appVersion: "0.1.0",
    activeEnrollmentId: snapshot.id,
    enrollments: [enrollmentOf(snapshot)],
  });
  return { backup, snapshot, today };
}

const text = (b: unknown) => JSON.stringify(b, null, 2);
const mutate = (fn: (b: Backup) => void): string => {
  const { backup } = week4Backup();
  const copy = structuredClone(backup);
  fn(copy);
  return text(copy);
};

describe("buildBackup / backupJson", () => {
  it("has the v1 envelope, is pretty-printed and round-trips through validateBackup", () => {
    const { backup } = week4Backup();
    expect(backup).toMatchObject({
      format: "learning-tracker-backup",
      formatVersion: 1,
      activeEnrollmentId: "enrollment-1",
    });
    const json = backupJson(backup);
    expect(json).toContain('\n  "format": "learning-tracker-backup",');
    const check = validateBackup(json);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.backup).toEqual(backup);
      expect(check.migratedFrom).toBeNull();
    }
  });

  it("names the file and hashes its text", () => {
    expect(backupFilename("2026-11-12")).toBe("learning-tracker-backup_2026-11-12.json");
    expect(backupSourceHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("gives the same snapshot back, including shift undo eligibility and tombstones", () => {
    const { backup, snapshot } = week4Backup();
    const restored = snapshotFromBackup(backup.enrollments[0]!);
    expect(restored.tombstones).toEqual(
      [...snapshot.tombstones].sort((a, b) => (a.taskId < b.taskId ? -1 : 1)),
    );
    expect(restored.taskStates).toEqual(
      [...snapshot.taskStates].sort((a, b) => (a.taskId < b.taskId ? -1 : 1)),
    );
    expect(restored.shifts.map((s) => s.undoable)).toEqual([true]);
    expect(restored.noteMeta.map((n) => n.target).sort()).toEqual(
      snapshot.noteMeta.map((n) => n.target).sort(),
    );
  });
});

describe("validateBackup", () => {
  it("refuses a newer format with backup-too-new", () => {
    const check = validateBackup(
      mutate((b) => ((b as { formatVersion: number }).formatVersion = 2)),
    );
    expect(check).toMatchObject({ ok: false, code: "backup-too-new" });
  });

  it("migrates an older format forward step by step", () => {
    const old = mutate((b) => {
      (b as { formatVersion: number }).formatVersion = 1;
      (b as unknown as { exportedOn: string }).exportedOn = b.exportedAt;
      delete (b as Partial<Backup>).exportedAt;
    });
    // Pretend the current format is 2, whose v1 → v2 step renamed exportedOn → exportedAt.
    const steps = {
      1: (b: Record<string, unknown>) => {
        const { exportedOn, ...rest } = b;
        return { ...rest, exportedAt: exportedOn, formatVersion: 1 };
      },
    };
    const check = validateBackup(old, steps, 2);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.migratedFrom).toBe(1);
    expect(validateBackup(old, {}, 2)).toMatchObject({ ok: false, code: "backup-invalid" });
  });

  it("refuses non-JSON, a different format and a broken structure", () => {
    expect(validateBackup("{nope")).toMatchObject({
      ok: false,
      issues: [{ rule: "json-syntax" }],
    });
    expect(validateBackup('{"format":"other"}')).toMatchObject({
      ok: false,
      issues: [{ pointer: "/format" }],
    });
    const broken = validateBackup(
      mutate((b) => {
        (b.enrollments[0]!.taskStates[0] as { status: string }).status = "finished";
      }),
    );
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.code).toBe("backup-invalid");
      expect(broken.issues.some((i) => i.pointer.startsWith("/enrollments/0/taskStates/0"))).toBe(
        true,
      );
    }
  });

  it("points at a Note on an unknown Task", () => {
    const check = validateBackup(
      mutate((b) => {
        b.enrollments[0]!.notes.push({
          target: "task:no-such-task",
          body: "x",
          fromTemplate: false,
          createdAt: "2026-09-30T00:00:00.000Z",
          updatedAt: "2026-09-30T00:00:00.000Z",
          editedOn: ["2026-09-30"],
        });
      }),
    );
    const index = week4Backup().backup.enrollments[0]!.notes.length;
    expect(check).toMatchObject({
      ok: false,
      code: "backup-invalid",
      issues: [{ pointer: `/enrollments/0/notes/${index}/target`, rule: "reference" }],
    });
  });

  it("checks every reference, the path copy, its hash and the active id", () => {
    const cases: [string, (b: Backup) => void, string][] = [
      ["state", (b) => (b.enrollments[0]!.taskStates[0]!.taskId = "ghost"), "/taskStates/0/taskId"],
      ["shift", (b) => b.enrollments[0]!.shifts[0]!.taskIds.push("ghost"), "/shifts/0/taskIds/"],
      ["path", (b) => ((b.enrollments[0]!.path as { title: unknown }).title = 5), "/path/title"],
      ["hash", (b) => (b.enrollments[0]!.pathHash = "0".repeat(64)), "/pathHash"],
      ["active", (b) => (b.activeEnrollmentId = "nobody"), "/activeEnrollmentId"],
      [
        "todo date",
        (b) => {
          const s = b.enrollments[0]!.taskStates.find((x) => x.status === "done")!;
          s.status = "todo";
        },
        "/statusDate",
      ],
    ];
    for (const [name, fn, pointer] of cases) {
      const check = validateBackup(mutate(fn));
      expect(check.ok, name).toBe(false);
      if (!check.ok) expect(check.issues.map((i) => i.pointer).join(" "), name).toContain(pointer);
    }
  });

  it("accepts a removed Task's state and Note (they point at tombstones)", () => {
    const { backup } = week4Backup();
    const e = backup.enrollments[0]!;
    expect(e.tombstones).toHaveLength(2);
    expect(e.notes.some((n) => e.tombstones.some((t) => n.target === `task:${t.taskId}`))).toBe(
      true,
    );
    expect(validateBackup(text(backup)).ok).toBe(true);
  });
});

describe("backupSummary", () => {
  it("lists each Enrollment with title, start date, derived percent and Note count", () => {
    const { backup, snapshot, today } = week4Backup();
    const summary = backupSummary(backup, today);
    expect(summary.exportedAt).toBe("2026-09-30T12:00:00.000Z");
    expect(summary.enrollments).toEqual([
      {
        id: "enrollment-1",
        title: snapshot.path.title,
        startDate: "2026-09-07",
        percent: stats(snapshot, today).percent,
        notes: snapshot.noteMeta.length,
        active: true,
      },
    ]);
  });
});
