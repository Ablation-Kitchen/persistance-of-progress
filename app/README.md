# Learning tracker: the app

Running, upgrading, data and Backups, and authoring paths are covered in the [project README](../README.md). The build spec is [`../spec/SPEC.md`](../spec/SPEC.md).

## Develop

Node 26 (see `.nvmrc`).

```sh
npm install
npm run dev:server      # Fastify on :3000 (data in server/.data, paths from ./paths)
npm run dev:web         # Vite on :5173, proxies /api to :3000
```

Dev builds accept `?today=YYYY-MM-DD` on any page to view the run on another date; production builds ignore it.

## Check

```sh
npm run build -w core   # web and server import core from dist: rebuild it after core changes
npm run typecheck && npm run lint && npm run format:check && npm test
```

## End-to-end

```sh
npm run e2e
```

Runs the 17-week walkthrough (`e2e/walkthrough.spec.ts`) in the installed Google Chrome against a freshly built container. It uses its own Compose project (`lt-e2e`), volume, port (4399) and a temporary copy of `paths/`, so it never touches a running instance or your `appdata` volume. It removes its container, volume and image when it finishes.
