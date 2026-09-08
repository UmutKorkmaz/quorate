# syntax=docker/dockerfile:1.7
FROM node:22-slim AS deps

WORKDIR /app

# Copy workspace manifests first so the layer is cached unless deps change
COPY package.json package-lock.json ./
COPY packages/core/package.json      ./packages/core/package.json
COPY packages/github-action/package.json ./packages/github-action/package.json
COPY packages/github-app/package.json   ./packages/github-app/package.json

RUN npm ci --include=dev --include-workspace-root --workspace @quorate/core \
           --workspace @quorate/github-action \
           --workspace @quorate/github-app

# ── build stage ──────────────────────────────────────────────────────────────
FROM deps AS build

COPY packages/core/src        ./packages/core/src
COPY packages/core/tsconfig.json ./packages/core/tsconfig.json
COPY tsconfig.base.json       ./tsconfig.base.json

COPY packages/github-action/src      ./packages/github-action/src
COPY packages/github-action/tsconfig.json ./packages/github-action/tsconfig.json

COPY packages/github-app/src         ./packages/github-app/src
COPY packages/github-app/tsconfig.json   ./packages/github-app/tsconfig.json
COPY packages/github-app/esbuild.config.mjs ./packages/github-app/esbuild.config.mjs

# Build core first (tsc composite), then bundle the app server
RUN npm run build --workspace @quorate/core \
 && npm run build --workspace @quorate/github-app

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# Only copy the compiled bundle + the static public assets
COPY --from=build /app/packages/github-app/dist    ./dist
COPY packages/github-app/public ./public

EXPOSE 3000

ENV NODE_ENV=production
ENV QUORATE_APP_STATE_DIR=/app/state
RUN mkdir -p /app/state && chown node:node /app/state
VOLUME ["/app/state"]

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
