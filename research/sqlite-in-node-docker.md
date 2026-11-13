# SQLite in a single-container Fastify app: `node:sqlite` vs `better-sqlite3`

Researched 2026-11-10. Setup assumed: one Docker container running Fastify, which also serves the built Vite/React frontend. SQLite lives on a Docker volume, the app starts with `docker compose up`, and hosts are macOS (Apple Silicon, Docker Desktop) or Linux.

## TL;DR

- **Use `node:sqlite` on Node 26 LTS** (`node:26-*` image). It needs no flag, it is at **Stability 1.2 "Release candidate"**, and it no longer prints an experimental warning. It has no native build step, which makes the Docker setup the simplest it can be. Its gaps vs better-sqlite3 (mainly `db.transaction()` and `.pluck()/.raw()`) can be filled with about 15 lines of helper code.
- `better-sqlite3` is a perfectly good fallback. Since v13 (July 2026) it uses N-API and **ships prebuilt binaries inside the npm tarball** for linux/linuxmusl × x64/arm64 and darwin. Alpine and Debian-slim on both architectures now install without a compiler.
- **Migrations:** use numbered `.sql` files plus `PRAGMA user_version`, each applied in a transaction. No library needed.
- **Storage:** keep the DB on a **named volume**, not a macOS bind mount. Never open the DB file from the host while the container has it open.

## 1. `node:sqlite` status in current Node LTS

| Line | Status (Nov 2026) | `node:sqlite` stability | Flag? | Notes |
|---|---|---|---|---|
| 26.x "Lithium" | **Active LTS since 2026-10-28**, EOL 2029-04-30 | 1.2 Release candidate | none | Class renamed `Database` / `Statement`; `DatabaseSync` / `StatementSync` kept as doc-only deprecated aliases (DEP0210/DEP0211, v26.11.0) |
| 24.x "Krypton" | Maintenance LTS since 2026-10-20, EOL 2028-04-30 | 1.2 Release candidate (since v24.15.0) | none | Class is `DatabaseSync` |
| 22.x "Jod" | Maintenance LTS, EOL 2027-04-30 | 1.1 Active development | none (unflagged in v22.13.0) | Still emits `ExperimentalWarning` (verified locally on v22.19.0) |

Sources:
- Release schedule: https://github.com/nodejs/Release and https://nodejs.org/en/about/previous-releases (v26.13.0 is "Latest LTS").
- v26 docs: https://nodejs.org/api/sqlite.html. History: "v25.7.0: SQLite is now a release candidate", "v23.4.0, v22.13.0: SQLite is no longer behind `--experimental-sqlite` but still experimental." Stability: "1.2 - Release candidate."
- v24 docs: https://nodejs.org/docs/latest-v24.x/api/sqlite.html (RC as of v24.15.0).
- v22 doc source: https://github.com/nodejs/node/blob/v22.x/doc/api/sqlite.md ("Stability: 1.1 - Active development").
- The RC change removed the runtime warning. PR https://github.com/nodejs/node/pull/61262: "Mark the SQLite module as release candidate and remove the experimental warning."
- Rename/aliases: https://github.com/nodejs/node/blob/v26.x/lib/sqlite.js and https://nodejs.org/api/deprecations.html#dep0210-sqlitedatabasesync.
- Bundled SQLite in v26.x: **3.54.0** (from `deps/sqlite/sqlite3.h` on the v26.x branch: https://github.com/nodejs/node/blob/v26.x/deps/sqlite/sqlite3.h).

What "Release candidate" means: per the Node stability index (https://nodejs.org/api/documentation.html#stability-index), 1.2 is "experimental" but near-stable, and breaking changes are still possible. The v26.11 class rename shows this in practice, although the old names were kept working. **If you want code to run on 22, 24 and 26, import `DatabaseSync`.** It is just a deprecated alias on 26, with no runtime warning.

### Useful defaults in `node:sqlite` (v26 docs)
- `enableForeignKeyConstraints: true` by default. In plain SQLite, foreign keys are OFF by default.
- `defensive: true` by default (changed in v25.5.0 / v24.14.0).
- `timeout` sets the busy timeout in ms (added v24.0.0 / v22.16.0). The default is 0, so **set it**, e.g. `timeout: 5000`.
- `enableDoubleQuotedStringLiterals: false`.

## 2. API comparison

All APIs in both libraries are **synchronous**. This is fine for a single-user local app, because queries run in microseconds to milliseconds.

| Capability | `node:sqlite` (v26) | `better-sqlite3` (v13) |
|---|---|---|
| prepare / run / get / all / iterate | yes | yes |
| `run()` → `{changes, lastInsertRowid}` | yes | yes |
| Named & positional params | yes (`allowBareNamedParameters` default true) | yes |
| **Transaction helper** | **no**: use `exec('BEGIN')` / `COMMIT` / `ROLLBACK`; `db.isTransaction` exists | **`db.transaction(fn)`**, with nested savepoints and `.deferred/.immediate/.exclusive` variants |
| `pragma()` helper | no (use `exec` / `prepare('PRAGMA …').get()`) | `db.pragma('…', {simple})` |
| Row shape | objects; `returnArrays` / `setReturnArrays()` | objects; `.raw()`, `.pluck()`, `.expand()` |
| BigInt | `readBigInts` / `setReadBigInts()` | `.safeIntegers()` |
| Column metadata | `stmt.columns()` | `stmt.columns()` |
| Expanded SQL | `stmt.expandedSQL`, `sourceSQL` | `stmt.toString()` (v13), `stmt.source` |
| UDFs / aggregates / window | `function()`, `aggregate()` | `function()`, `aggregate()` |
| Virtual tables in JS | `createModule()` (v26.11.0+) | `db.table()` |
| Online backup | `sqlite.backup(db, path, {rate, progress})` → Promise | `db.backup(dest, {progress})` → Promise |
| serialize / deserialize | yes (v26.1.0+) | `serialize()`; deserialize via `new Database(buffer)` |
| Extensions | `allowExtension` + `loadExtension()` | `loadExtension()` |
| Sessions / changesets | yes (`createSession`, `applyChangeset`) | no |
| Authorizer | `setAuthorizer()` | no |
| Prepared-statement cache / tagged templates | `createTagStore()` (sql\`…\`) | no |
| Query stats | `stmt.stat()` (v26.8.0+) | no |
| `explain()` helper | no | `db.explain()` (v13) |
| Install footprint | zero (built into node) | ~27 MB unpacked tarball (all prebuilds included) |
| Bundled SQLite | 3.54.0 (Node v26.x) | 3.53.4 (docs/compilation.md) |
| Custom SQLite build / encryption (SQLCipher etc.) | no | yes (`--build-from-source --sqlite3=…`) |

Sources: https://nodejs.org/api/sqlite.html; https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md; https://github.com/WiseLibs/better-sqlite3/blob/master/docs/compilation.md; v13.0.0 release notes: https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0.

The only gap that matters for a CRUD app is `transaction()`. A minimal replacement:

```js
export function tx(db, fn) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(...args); db.exec('COMMIT'); return r; }
    catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
  };
}
```

This helper does not nest. If you need nesting, use `SAVEPOINT`. Do not make `fn` async: an `await` inside it would interleave other requests' statements into the open transaction. The better-sqlite3 docs warn about the same thing.

## 3. better-sqlite3 native build/prebuild on Alpine vs Debian-slim, arm64/amd64

What changed in **v13.0.0 (2026-07-21)**: "the first version of better-sqlite3 to run on the N-API … prebuilt binaries should theoretically work across different versions of Node.js … we've removed the deprecated `prebuild-install` dependency, and now prebuilt binaries are published directly with the better-sqlite3 code itself." (https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)

Verified by inspecting the npm tarball for 13.0.3. `package/prebuilds/` contains `linux-x64`, `linux-arm64`, `linuxmusl-x64`, `linuxmusl-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64` and `win32-arm64` `.node` files. `engines.node` is `>=22`. The loader (`lib/binding.js`) detects musl by checking `process.report.getReport().header.glibcVersionRuntime`, then loads `prebuilds/<platform>-<arch>.node`. If no prebuild matches, it falls back to `build/Release/better_sqlite3.node`. That file only exists if you built from source (`binding.gyp` builds only when `prebuild_exists==0` or `force_build==1`).

Build provenance (`.github/workflows/build.yml`):
- glibc prebuilds are built on `ubuntu-22.04` / `ubuntu-22.04-arm` (glibc 2.35). They should load on `node:*-bookworm-slim` (glibc 2.36) and newer.
- musl prebuilds are built inside `node:22-alpine` on `ubuntu-24.04` / `ubuntu-24.04-arm`.

Implications:
- **v13+, Alpine or Debian-slim, amd64 or arm64:** a plain `npm ci` needs no python/make/g++. This holds on Apple Silicon hosts, where Docker builds linux/arm64.
- **Before v13 (≤12.x):** prebuilds were per-ABI GitHub release assets downloaded by `prebuild-install` at install time. Install failed without network access, and fell back to node-gyp on a new Node major or a missing musl/arm combination. That is why "better-sqlite3 on Alpine needs `apk add python3 make g++`" advice exists. It no longer applies to v13.
- **Remaining gotchas:**
  1. Don't copy a host `node_modules` into the image (macOS darwin binary vs linux). Run `npm ci` inside the Dockerfile and add `node_modules` to `.dockerignore`. The package now carries all platforms' binaries, so this is less likely to break, but it is still good hygiene.
  2. A custom SQLite build requires the full toolchain.
  3. Exotic architectures (armv7, ppc64le, s390x) have no prebuild.
  4. I could not confirm from the repo docs whether a source build still runs automatically when no prebuild matches (`package.json` sets `"gypfile": false` and has no install script). Treat unsupported platforms as "build manually with `npm run build-release`".

## 4. Lightweight migrations

Recommended: **plain numbered SQL files + `PRAGMA user_version`**. No dependency, about 25 lines of code.

- `user_version` is "an integer at offset 60 in the database header … available to applications to use however they want. SQLite makes no use of the user-version itself." (https://www.sqlite.org/pragma.html#pragma_user_version)
- Optionally set `PRAGMA application_id` so `file(1)` identifies your DB (https://www.sqlite.org/pragma.html#pragma_application_id).

```
server/migrations/
  0001_init.sql
  0002_add_lessons.sql
```

```js
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function migrate(db, dir) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  const files = readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const v = Number(f.slice(0, 4));
    if (v <= current) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(join(dir, f), 'utf8'));
      db.exec(`PRAGMA user_version = ${v}`);   // pragmas can't take bound params
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw new Error(`migration ${f} failed: ${e.message}`); }
  }
}
```

Rules that come from SQLite itself:
- SQLite DDL is transactional, so a failed migration rolls back cleanly, including the `user_version` bump.
- `PRAGMA foreign_keys` "is a no-op within a transaction" (https://www.sqlite.org/pragma.html#pragma_foreign_keys). If a migration needs the table-rebuild procedure, turn FKs off **before** `BEGIN` and run `PRAGMA foreign_key_check` before commit.
- `ALTER TABLE` is limited. Changing column types or adding constraints needs the 12-step "create new_X, copy, drop, rename" procedure (https://www.sqlite.org/lang_altertable.html#otheralter). This is the main reason to keep migrations as hand-written SQL rather than relying on a diffing tool.
- Run `migrate()` at Fastify startup, before `listen()`. There is one process, so there are no races.
- Migrations are forward-only. For rollback, take an `sqlite.backup()` copy before migrating.

When to use a library instead: if you adopt a query builder or ORM (Kysely, Drizzle), use its migrator. Otherwise the above is enough. (I did not research specific migration libraries in depth.)

## 5. WAL mode on Docker volumes vs bind mounts (Docker Desktop for macOS)

What SQLite requires (https://www.sqlite.org/wal.html):
- "All processes using a database must be on the same host computer; WAL does not work over a network filesystem." The wal-index (`-shm`) "is implemented using an ordinary file that is mmapped", and it is created "in the same directory as the database itself."
- "The WAL file is part of the persistent state of the database and should be kept with the database if the database is copied or moved. If a database file is separated from its WAL file, then transactions … might be lost, or the database file might become corrupted."
- The process needs write access to the **directory**, so it can create `-wal` / `-shm`. A read-only DB file is not enough. So mount a **directory** (e.g. `/data`), never a single `.db` file.
- WAL mode is persistent once set.
- `synchronous=NORMAL` in WAL is "the best balance between performance and safety". You lose durability on power loss, but transactions stay atomic (https://www.sqlite.org/pragma.html#pragma_synchronous).
- Broken file locking, especially on network filesystems, can cause corruption. So can copying a DB without its journal/WAL, or copying it mid-transaction (https://www.sqlite.org/howtocorrupt.html).

What Docker documents:
- On macOS, Docker Desktop runs Linux in a VM. Bind mounts of host folders go through VirtioFS (the default) or gRPC FUSE. Docker's own guidance: "For non-code items such as cache directories or databases, the performance will be much better" if stored in the Linux VM, i.e. in a named volume (https://docs.docker.com/desktop/settings-and-maintenance/settings/).
- Docker VMM known issue: "Certain databases, such as MongoDB and Cassandra, may fail when using virtiofs with Docker VMM" (https://docs.docker.com/desktop/features/vmm/).
- Volumes are "the preferred mechanism for persisting data generated by and used by Docker containers". They are not a good choice if you need host access to the files (https://docs.docker.com/engine/storage/volumes/).

Practical consequences (my inference from the above, not a documented Docker statement):
1. **Named volume (recommended):** the DB, `-wal` and `-shm` sit on the VM's native ext4. mmap and POSIX locks behave normally, and performance is good. The Docker docs don't cover this, but on Linux hosts a named volume is just a local directory under `/var/lib/docker/volumes`.
2. **macOS bind mount:** it is fine while **only the container** touches the files. Even then you pay VirtioFS overhead on every fsync and lock. The real danger is opening the same DB **from the host at the same time** (sqlite3 CLI, DB Browser, TablePlus) while the container has it open. The macOS process and the Linux process are effectively on different kernels, so they cannot share the `-shm` mmap. Lock semantics across the VirtioFS boundary are not something SQLite guarantees. This is the "different hosts / network filesystem" case that sqlite.org warns about, and it risks corruption.
3. **Linux host bind mount (native Docker Engine):** same kernel, so it is fine, even with host-side access. (Docker Desktop *for Linux* also uses a VM, so the macOS caveats apply there too.)
4. **Backups:** never `cp` only `app.db` out of a volume while the app runs. Use `sqlite.backup()` / `db.backup()`, or `VACUUM INTO '/data/backup.db'`, from inside the app. Alternatively, stop the container (the last connection closing checkpoints the WAL) and copy all three files.
5. On shutdown, handle SIGTERM in Fastify and call `db.close()` so the WAL checkpoints and `-shm` is removed. Optionally run `PRAGMA wal_checkpoint(TRUNCATE)` periodically or at shutdown. Set `stop_grace_period` if needed.
6. Permissions: the official node images run as `root` by default, and offer a `node` user (uid 1000). If you switch to `USER node`, make sure the volume directory is owned by uid 1000, e.g. `RUN mkdir /data && chown node:node /data` in the image so a fresh named volume inherits it. Otherwise WAL file creation fails with `SQLITE_CANTOPEN` / `readonly database`.

Suggested connection setup:

```js
import { DatabaseSync } from 'node:sqlite';       // works on 22/24/26; `Database` on 26.11+
const db = new DatabaseSync('/data/app.db', { timeout: 5000 }); // FKs on by default in node:sqlite
db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`);
```

```yaml
# compose.yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    volumes: ["appdata:/data"]
volumes:
  appdata:
```

## 6. Recommendation

**Use `node:sqlite` on `node:26-bookworm-slim` (or `node:26-alpine`).**

Why:
- Node 26 became Active LTS on 2026-10-28. `node:sqlite` there is unflagged, at Stability 1.2 Release candidate, and prints no warning.
- It has no native dependency, so there are no prebuild, ABI, musl or arm64 questions at all. Install and image build are faster, and there is one fewer supply-chain dependency.
- For a personal, single-process, low-concurrency app, its API covers everything needed. Add a 10-line `tx()` helper.
- It even ships a newer SQLite (3.54.0) than better-sqlite3 (3.53.4).

Accept these risks:
- RC still allows breaking changes, e.g. the v26.11 `DatabaseSync`→`Database` rename, which was kept backwards-compatible. Pin the Node major in the Dockerfile (`FROM node:26-…`) and read the sqlite section of release notes when bumping.
- Avoid Node 22 for this. It is still 1.1 with a runtime warning, and EOL is April 2027.

Switch to `better-sqlite3` (v13+) if you need any of these: `db.transaction()` semantics with nesting, a custom or encrypted SQLite build, or support for a Node line older than 24. Since v13 it is low-friction on both Alpine and Debian-slim, amd64 and arm64.

Regardless of driver:
- named volume mounted as a directory at `/data`
- WAL + `synchronous=NORMAL` + busy timeout
- `user_version` migrations at startup
- in-app online backups
- never open the live DB from the macOS host
