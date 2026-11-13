# Learning tracker

A locally run learning tracker. It loads a **Learning Path** (a YAML file of Blocks and Tasks, each Task on an explicit day) and turns it into a daily tracker: what to do today, what's overdue, Notes, and progress. There is one user, no login, and no automatic scheduling. You tick Tasks on the honour system, and the only thing that moves the schedule is a Schedule Shift you trigger yourself.

It runs as one Docker container: Node + Fastify, React, and SQLite on a Docker volume.

## Run it

You need Docker with Compose v2.

```sh
cd app
cp .env.example .env    # optional: change PORT
docker compose up --build
```

Then open **http://localhost:4321**. The server prints `Learning tracker ready at http://localhost:4321` once it's listening. No browser opens by itself.

On first run the app offers to load a path from `app/paths/`, upload a YAML file, or restore a Backup. The 17-week sample path is already in `app/paths/`.

### Change the port

Set `PORT` in `app/.env` (or `PORT=8080 docker compose up`). The container always listens on 3000; `PORT` is the host port.

### Use it from other devices on your network

By default the app is published on `127.0.0.1` only. To reach it from your LAN, edit the one `ports` line in `app/compose.yaml`:

```yaml
ports: ["${PORT:-4321}:3000"]   # was "127.0.0.1:${PORT:-4321}:3000"
```

> **There is no login.** Anyone who can reach that port can read and change everything, including deleting Enrollments and restoring a Backup over your data. Only do this on a network you trust.

### Upgrade

```sh
cd app
git pull && docker compose up --build
```

Your data stays in the volume. When a new version changes the database layout, the server first writes a Safety Copy (see below) and then migrates.

## Your data

> **Everything lives in the `appdata` Docker volume.** `docker compose down -v`, `docker volume rm`, or a Docker Desktop "clean up" **wipes all of it**: every Enrollment, tick and Note. **Download Backups** (app menu → *Download backup*) and keep them somewhere else.

- Compose names the volume after the folder it runs in, so it's `app_appdata` when you run from `app/`. `docker compose down` without `-v` keeps it.
- **"last backup: N days ago"** in the app menu is approximate. It records when the server finished sending a Backup, not whether you kept the file. A download you cancelled or deleted still counts. It also counts a Backup that was restored, since a restore brings back the backup's own date.
- **Restore** replaces everything (all Enrollments and the active one) after showing you a preview. It's all-or-nothing: a failed restore changes nothing.
- **Notes → Export** gives a Markdown file of one Enrollment's Notes, for reading or keeping elsewhere. It is not a Backup and can't be imported back.

### Safety Copies

The server writes automatic copies into the same volume (`/data` inside the container) before risky changes:

| When | File | Kept |
|---|---|---|
| Before a restore | `pre-restore-<timestamp>.json` (a full JSON Backup) | newest 3 |
| Before a database migration | `pre-migrate-v<old>-<timestamp>.db` (a SQLite copy) | newest 3 |

They live on the same volume as your data, so they **don't protect you from `down -v`**. To copy one out:

```sh
cd app
docker compose exec app ls /data
docker compose cp app:/data/pre-restore-<timestamp>.json .
```

A `pre-restore-*.json` file can be restored through the app like any Backup.

## Authoring Learning Paths

A path is a YAML file in `app/paths/` (mounted read-only at `/paths`), or an upload. It must validate against the JSON Schema in [`app/core/schema/learning-path.schema.json`](app/core/schema/learning-path.schema.json). Use [`app/paths/eval-infra-17-weeks.yaml`](app/paths/eval-infra-17-weeks.yaml) as a worked example. The app lists every file it finds there with its validation status, and shows each problem with its line number.

- Task `id`s are what progress and Notes hang on. Keep them stable when you edit a path.
- Editing a file that an Enrollment came from shows a **"The path file has changed — review reload"** banner. Nothing reloads by itself; the preview lists added, removed, moved and changed Tasks before you apply it. Removed Tasks that have progress or a Note are kept hidden, not deleted, and come back if you restore them to the file.
- [`app/core/schema/generated/learning-path.generation.schema.json`](app/core/schema/generated/learning-path.generation.schema.json) is a derived version of the schema for LLM structured output (generating paths with a model). Rebuild it with `npm run build:generation-schema -w core` in `app/`.

## Repository layout

| Path | What's there |
|---|---|
| [`app/`](app/) | The application: npm workspaces `core` (pure TypeScript: schema, loader, derived signals, reload diff, export, API contracts), `server` (Fastify, SQLite, migrations), `web` (React + Vite), plus `paths/`, the Dockerfile and `compose.yaml`. See [`app/README.md`](app/README.md) for development. |
| [`spec/SPEC.md`](spec/SPEC.md) | The build spec, and [`spec/build-tickets/`](spec/build-tickets/README.md), the 16 tickets it was built from. |
| [`GLOSSARY.md`](GLOSSARY.md) | The domain terms (Learning Path, Enrollment, Task, Block, Schedule Shift…). Code and UI use them. |
| [`.wayfinder/issues/`](.wayfinder/issues/) | The design decisions behind the spec, with the alternatives that weren't chosen. |
| [`prototypes/`](prototypes/) | The throwaway HTML prototypes of the Today, Path and Notes screens. |
| [`research/`](research/), [`samples/`](samples/), [`schema/`](schema/) | Background research, the source of the sample plan, and the schema as first designed. |

## License

[MIT](LICENSE)
