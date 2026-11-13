# Local issue tracker (wayfinder)

No remote tracker is configured, so issues live here as Markdown files.

- One file per issue: `issues/<id>-<slug>.md`, id is the issue identity.
- Front matter: `title`, `labels`, `status` (open|closed), `assignee` (the claim), `parent` (map id), `blocked_by` (list of ids).
- **Frontier** = issues with `parent: 1`, `status: open`, no `assignee`, and every `blocked_by` id closed.
- Resolution = append a `## Resolution` section, set `status: closed`, add a line to the map's Decisions so far.
- Research findings live in `/research/<name>.md` (repo is not under git, so no research branches), linked from the ticket.
