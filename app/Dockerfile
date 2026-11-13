# syntax=docker/dockerfile:1

# ---- build: install everything, build core → web → server ----
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY core core
COPY server server
COPY web web
RUN npm run build

# ---- runtime: production deps for core + server, the built output and web/dist ----
FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace=core --workspace=server && npm cache clean --force
COPY --from=build /app/core/dist core/dist
COPY --from=build /app/core/schema core/schema
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
COPY --from=build /app/web/dist web/dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/dist/main.js"]
