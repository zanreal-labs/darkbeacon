# syntax=docker/dockerfile:1

# ---- build: install everything, compile server and packages, bundle the web app
FROM node:24-bookworm AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
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

# ---- runtime: node, production dependencies and build output only
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
# With node-linker=hoisted, workspace links live in each package's own node_modules.
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
# First-party plugins and themes: the catalogue admins install from.
COPY --from=build /app/plugins ./plugins
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/server/dist/main.js"]
