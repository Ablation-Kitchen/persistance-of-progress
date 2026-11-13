---
title: "Path screen outline"
status: closed
blocked_by: [7]
---

**Spec:** §7.4 (everything except the Resource Index), §5 (Block stats). **Visual reference:** [Path prototype](../../prototypes/path-screen/path-prototype.html) variant A.

## Scope

- The hero with four stats.
- Collapsible Block sections: the current one open, expand all / collapse, the header metrics and state tag.
- Weeks with a "this week" tag. Task rows with effective dates, an expandable description, links, authored day and offset, and "open day N in Today →".
- Filter chips in `?filter=`.
- The shift marker and the "moved +Nd by a shift" note in week headings.
- Optional-past rows rendered muted and tickable.
- The "Removed from the path" section, linking to `/notes?block=removed`.
- Ticking reuses 07's mutation.
- The sticky side column, which stays empty until 11.

## Acceptance

- [x] On the fixture at week 4 after +2 with 2 tombstones (a seeded test database): the shift marker shows once in its week, each affected week heading says "moved +2d by a shift" once, and no row repeats it.
- [x] Block 2 is `current` and open, Block 1 shows its real `done/required`, and the state tags follow §5.
- [x] Filter "overdue" shows only overdue rows, and the filter survives a refresh (URL).
- [x] "open day 24 in Today" lands on `/today?day=<that date>` with day 24's Tasks.
- [x] Removed Tasks are listed with their kind, former day, status and a Note excerpt.
