---
title: "README and end-to-end acceptance"
status: open
blocked_by: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
---

**Spec:** §11 (README), §12.

## Scope

- `README.md`:
  - running the app, `PORT`, LAN access and the no-login warning;
  - upgrading;
  - authoring paths (link the schema and the generation schema);
  - **data lives in the `appdata` volume, and `docker compose down -v` wipes it, so download Backups**;
  - "last backup" is approximate;
  - Safety Copies (where they are and how many are kept).
- A Playwright end-to-end script against `docker compose up` on a fresh volume, with the browser clock fixed through Playwright's clock API.

## Acceptance: the 17-week walkthrough

- [ ] First run: empty state → load the fixture → start date = next Monday → "Almost ready".
- [ ] Advance the clock to day 1: tick two Tasks and write a Day Note. The streak is 1.
- [ ] Advance to week 4 without ticking: Catch up lists the overdue Tasks. Shift +2; Catch up empties for Tasks now in their windows. The Path screen shows the shift marker once.
- [ ] Open the story bank: the template shows, and after typing the Note is "from template".
- [ ] Edit the fixture in `./paths` (remove a done Task that has a Note): the banner appears → preview → apply. The Note is under Notes → Removed tasks.
- [ ] Export Notes: the file downloads with the expected name, and its outline is Block → week → day.
- [ ] Download a Backup → `docker compose down -v && up` → Restore → every screen matches the state before the wipe.
- [ ] Throughout: no console errors, and every API error shows a toast or a dialog with the server's message.
