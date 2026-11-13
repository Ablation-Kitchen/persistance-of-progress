# Learning tracker

A locally run tracker for Learning Path files. The full spec is in [`../spec/SPEC.md`](../spec/SPEC.md).

> Scaffold stage (build ticket 01). The full README arrives with ticket 16.

## Run

```sh
cp .env.example .env    # optional: change PORT
docker compose up --build
```

Then open http://localhost:4321. The app is published on `127.0.0.1` only.

## Develop

```sh
npm install
npm run dev:server      # Fastify on :3000
npm run dev:web         # Vite on :5173, proxies /api to :3000
npm run build && npm run typecheck && npm run lint && npm test
```
