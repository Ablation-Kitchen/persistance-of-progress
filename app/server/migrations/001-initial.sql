-- Every table in spec §4.1. Later tickets add no migrations of their own.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,   -- activeEnrollmentId | lastBackupAt | appStateVersion
  value TEXT NOT NULL
) STRICT;

CREATE TABLE enrollments (
  id            TEXT PRIMARY KEY,          -- crypto.randomUUID()
  path_id       TEXT NOT NULL,
  path_json     TEXT NOT NULL,
  path_hash     TEXT NOT NULL,
  start_date    TEXT NOT NULL,             -- local YYYY-MM-DD
  created_at    TEXT NOT NULL,             -- UTC ISO
  loaded_at     TEXT NOT NULL,
  reloaded_at   TEXT,
  state_version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE task_states (
  enrollment_id TEXT NOT NULL REFERENCES enrollments (id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('todo', 'done', 'skipped')),
  status_date   TEXT,
  offset_days   INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (enrollment_id, task_id)
) STRICT;

CREATE TABLE notes (
  enrollment_id TEXT NOT NULL REFERENCES enrollments (id) ON DELETE CASCADE,
  target        TEXT NOT NULL,             -- 'task:<id>' | 'day:YYYY-MM-DD' | 'enrollment'
  body          TEXT NOT NULL,
  from_template INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (enrollment_id, target)
) STRICT;

CREATE TABLE note_edits (
  enrollment_id TEXT NOT NULL REFERENCES enrollments (id) ON DELETE CASCADE,
  target        TEXT NOT NULL,
  edited_on     TEXT NOT NULL,             -- local date
  PRIMARY KEY (enrollment_id, target, edited_on)
) STRICT;

CREATE TABLE shifts (
  id            INTEGER PRIMARY KEY,
  enrollment_id TEXT NOT NULL REFERENCES enrollments (id) ON DELETE CASCADE,
  applied_on    TEXT NOT NULL,
  days          INTEGER NOT NULL,
  task_ids      TEXT NOT NULL,             -- JSON array
  created_at    TEXT NOT NULL
) STRICT;
CREATE INDEX shifts_by_enrollment ON shifts (enrollment_id, id);

CREATE TABLE tombstones (
  enrollment_id TEXT NOT NULL REFERENCES enrollments (id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  former_day    INTEGER NOT NULL,
  removed_at    TEXT NOT NULL,
  PRIMARY KEY (enrollment_id, task_id)
) STRICT;
