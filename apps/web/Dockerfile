# Production image for apps/web (AUTH-7.0). Multi-stage: a full workspace
# install builds the Next.js production bundle, then a separate
# production-only install keeps the runtime image lean. Workspace packages
# (packages/*) export raw TypeScript from ./src (see each package.json
# "exports"): Bun transpiles them at run time, so there is no package build
# step to run before `next build` — only the source tree needs to be present.
#
# Base image: oven/bun:1.4.2-slim, pinned to the exact version in
# .bun-version (glibc/Debian, not -alpine): Next.js ships glibc-linked
# @next/swc native binaries, and Debian-slim avoids musl compatibility risk
# for a marginal size difference. scripts/verify-deploy-config.test.ts fails
# if this tag drifts from .bun-version.
FROM oven/bun:1.4.2-slim AS base
WORKDIR /app

# ---- deps: full workspace install (dev + prod) needed to run `next build`
# (tailwindcss/postcss run at build time; typecheck is not run in this
# image, `bun check` covers it in CI).
FROM base AS deps
COPY package.json bun.lock .bun-version ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ai-voice/package.json packages/ai-voice/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/clock/package.json packages/clock/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/debate-engine/package.json packages/debate-engine/package.json
COPY packages/errors/package.json packages/errors/package.json
COPY packages/ingress/package.json packages/ingress/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/media/package.json packages/media/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/redis/package.json packages/redis/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY apps/log-shipper/package.json apps/log-shipper/package.json
COPY apps/media-worker/package.json apps/media-worker/package.json
COPY apps/realtime/package.json apps/realtime/package.json
RUN bun install --frozen-lockfile

# ---- build: full source + `next build` (production bundle only; the app is
# started by src/server/start.ts, never `next start`).
FROM deps AS build
COPY . .
# `.next/cache` is Turbopack's build-time incremental cache (~130MB here):
# useful for rebuild speed, unneeded and never read at runtime, dropped
# before the runtime stage copies from this layer so it never ships.
# DAISY_IMAGE_BUILD=1 skips next build's own TypeScript pass (ISSUE-527):
# it stalled Fly's remote builder for 25+ minutes, and CI's typecheck already
# gates every commit deploy-staging ships. Nothing else sets it.
RUN DAISY_IMAGE_BUILD=1 NODE_ENV=production bun run --cwd apps/web build \
  && rm -rf apps/web/.next/cache

# ---- prod-deps: a second, production-only install for the runtime image.
# Workspace packages have no separate "dist": their ./src TypeScript ships
# as-is, so this stage still needs the full source tree, just not
# devDependencies (eslint, jscpd, playwright, typescript, ...).
FROM base AS prod-deps
COPY package.json bun.lock .bun-version ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ai-voice/package.json packages/ai-voice/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/clock/package.json packages/clock/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/debate-engine/package.json packages/debate-engine/package.json
COPY packages/errors/package.json packages/errors/package.json
COPY packages/ingress/package.json packages/ingress/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/media/package.json packages/media/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/redis/package.json packages/redis/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY apps/log-shipper/package.json apps/log-shipper/package.json
COPY apps/media-worker/package.json apps/media-worker/package.json
COPY apps/realtime/package.json apps/realtime/package.json
RUN bun install --frozen-lockfile --production

# ---- server-source: non-root, the production dependencies and every
# workspace package's source, shared by the three service images below.
FROM base AS server-source
# Deployment identity: production refuses to boot at the `development`/
# `unknown` defaults (packages/config/src/index.ts). Passed with
# `fly deploy --build-arg APP_VERSION=... --build-arg GIT_COMMIT=...`
# (see docs/operations/deploy-staging.md step 6); baked in as ENV so they
# are present in the running container, not just at build time.
ARG APP_VERSION=development
ARG GIT_COMMIT=unknown
ENV APP_VERSION=${APP_VERSION}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 daisy \
  && useradd --system --uid 1001 --gid daisy --home-dir /app --shell /usr/sbin/nologin daisy
# Bun's isolated linker gives every workspace its own node_modules (symlinks
# into a shared /app/node_modules/.bun store), not just a root node_modules:
# copy the whole prod-deps tree rather than cherry-picking node_modules
# directories, then overlay source and build output on top of it.
COPY --from=prod-deps --chown=daisy:daisy /app /app
COPY --chown=daisy:daisy packages/auth/src packages/auth/src
COPY --chown=daisy:daisy packages/clock/src packages/clock/src
COPY --chown=daisy:daisy packages/config/src packages/config/src
COPY --chown=daisy:daisy packages/db/src packages/db/src
# fly.migrate.toml's release_command runs the migration runner directly out
# of the web image (see packages/db/scripts/migrate.ts); it and the
# migrations it applies are not otherwise reachable from the runtime stage.
COPY --chown=daisy:daisy packages/db/scripts packages/db/scripts
COPY --chown=daisy:daisy packages/db/migrations packages/db/migrations
COPY --chown=daisy:daisy packages/ai-voice/src packages/ai-voice/src
COPY --chown=daisy:daisy packages/debate-engine/src packages/debate-engine/src
COPY --chown=daisy:daisy packages/errors/src packages/errors/src
COPY --chown=daisy:daisy packages/ingress/src packages/ingress/src
COPY --chown=daisy:daisy packages/logger/src packages/logger/src
COPY --chown=daisy:daisy packages/media/src packages/media/src
COPY --chown=daisy:daisy packages/observability/src packages/observability/src
COPY --chown=daisy:daisy packages/protocol/src packages/protocol/src
COPY --chown=daisy:daisy packages/redis/src packages/redis/src
USER daisy

# ---- realtime: apps/realtime (fly.realtime.toml, ISSUE-528). Built with
# `--build-target realtime`, which never runs the Next build stage.
FROM server-source AS realtime
COPY --chown=daisy:daisy apps/realtime/src apps/realtime/src
WORKDIR /app/apps/realtime
# Fly's http_service.internal_port; start.ts reads these two.
ENV REALTIME_PORT=8080
ENV REALTIME_HOST=0.0.0.0
EXPOSE 8080
CMD ["bun", "src/start.ts"]

# ---- media-worker: apps/media-worker, the capture worker
# (fly.media-worker.toml, ISSUE-528). No port: it only calls out.
FROM server-source AS media-worker
COPY --chown=daisy:daisy apps/media-worker/src apps/media-worker/src
WORKDIR /app/apps/media-worker
CMD ["bun", "src/start.ts"]

# ---- log-shipper: apps/log-shipper, the operational log shipper
# (fly.log-shipper.toml, ADR 0081). No port: it only calls out.
FROM server-source AS log-shipper
COPY --chown=daisy:daisy apps/log-shipper/src apps/log-shipper/src
WORKDIR /app/apps/log-shipper
CMD ["bun", "src/start.ts"]

# ---- admin-build: the admin app's Next build (ADR 0077), selected only by
# the admin target below; it keeps its own TypeScript pass (a small app).
FROM deps AS admin-build
COPY . .
RUN NODE_ENV=production bun run --cwd apps/admin build \
  && rm -rf apps/admin/.next/cache

# ---- admin-source: non-root, the production dependencies and only the
# packages the admin app imports. No participant database or Redis source
# ships in an admin image, and of @daisy/auth only the operator signer
# (ADR 0079), which imports nothing but @daisy/protocol.
FROM base AS admin-source
ARG APP_VERSION=development
ARG GIT_COMMIT=unknown
ENV APP_VERSION=${APP_VERSION}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 daisy \
  && useradd --system --uid 1001 --gid daisy --home-dir /app --shell /usr/sbin/nologin daisy
COPY --from=prod-deps --chown=daisy:daisy /app /app
COPY --chown=daisy:daisy packages/auth/src/operator-signature.ts packages/auth/src/operator-signature.ts
COPY --chown=daisy:daisy packages/clock/src packages/clock/src
COPY --chown=daisy:daisy packages/logger/src packages/logger/src
COPY --chown=daisy:daisy packages/protocol/src packages/protocol/src
COPY --chown=daisy:daisy apps/admin/src apps/admin/src
WORKDIR /app/apps/admin
USER daisy

# ---- admin-migrate: fly.admin-migrate.toml's release command migrates the
# admin database as its owner (ADMIN_MIGRATION_DATABASE_URL), ADR 0041.
FROM admin-source AS admin-migrate
CMD ["bun", "src/db/migrate.ts"]

# ---- admin: apps/admin on 6PN only (fly.admin.toml); `fly proxy 4800:8080`.
FROM admin-source AS admin
COPY --chown=daisy:daisy apps/admin/next.config.ts apps/admin/next.config.ts
COPY --from=admin-build --chown=daisy:daisy /app/apps/admin/.next .next
ENV ADMIN_PORT=8080
ENV ADMIN_HOST=::
EXPOSE 8080
CMD ["bun", "src/server/start.ts"]

# ---- runtime: the web app, and the default target (the last stage).
FROM server-source AS runtime
# Fly's http_service.internal_port; start.ts reads PORT and binds 0.0.0.0.
ENV PORT=8080
COPY --chown=daisy:daisy apps/web/src apps/web/src
COPY --chown=daisy:daisy apps/web/public apps/web/public
COPY --chown=daisy:daisy apps/web/next.config.ts apps/web/next.config.ts
COPY --chown=daisy:daisy apps/web/postcss.config.mjs apps/web/postcss.config.mjs
COPY --from=build --chown=daisy:daisy /app/apps/web/.next apps/web/.next
WORKDIR /app/apps/web
EXPOSE 8080
CMD ["bun", "src/server/start.ts"]
