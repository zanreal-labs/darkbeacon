# Load tools image: the fake ESI server, the synthetic WebSocket clients and the proxy for the
# two-replica run. Node only, one pinned dependency (ws). The seed generator runs in the
# application image instead, because it writes through the application's own code.
FROM node:24.11.1-bookworm-slim
WORKDIR /loadtest
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY *.mjs ./
USER node
