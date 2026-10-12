# syntax=docker/dockerfile:1

# ---- build: install everything, compile server and packages, build the web app (Next.js standalone)
FROM node:24-bookworm AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm fetch --store-dir /pnpm-store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm-store
RUN pnpm build
# Keep only production dependencies for the runtime image.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    rm -rf node_modules apps/*/node_modules packages/*/node_modules packages/modules/*/node_modules plugins/*/node_modules \
    && pnpm install --offline --frozen-lockfile --prod --store-dir /pnpm-store

# ---- runtime: node, production dependencies and build output only.
# One process tree, one public port: the API server listens on PORT and starts the web app's
# server (Next.js standalone, with its own traced node_modules) on a loopback port behind it.
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
# With node-linker=hoisted, workspace links live in each package's own node_modules.
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
# Owned by node: Next.js keeps its runtime cache next to the build.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./apps/web/.next/standalone
# First-party plugins and themes: the catalogue admins install from.
COPY --from=build /app/plugins ./plugins
RUN mkdir -p /data && chown node:node /data \
    && printf '#!/bin/sh\nexec node /app/apps/server/dist/cli.js "$@"\n' > /usr/local/bin/darkbeacon \
    && chmod 755 /usr/local/bin/darkbeacon
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# The preload starts OpenTelemetry before the app when OTEL_* asks for it (docs/observability.md);
# it loads nothing else while telemetry is off.
CMD ["node", "--enable-source-maps", "--import", "./apps/server/dist/adapters/observability/preload.js", "apps/server/dist/main.js"]
