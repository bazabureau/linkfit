# syntax=docker/dockerfile:1.7

# ─── Stage 1: builder ──────────────────────────────────────────────────────
# Install all deps (incl. dev) and compile TypeScript to dist/. We run on
# alpine to keep the image small; node:22-alpine includes wget which we
# also need at runtime for the HEALTHCHECK.
FROM node:22-alpine AS builder
WORKDIR /app

# Copy lockfile + manifest first to maximize Docker layer cache hits when
# only source files change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build

# ─── Stage 2: runtime ──────────────────────────────────────────────────────
# Only production deps + compiled dist + migrations are shipped. The
# image runs as the built-in `node` user (uid 1000) so a container
# escape can't write outside the WORKDIR or modify system files.
FROM node:22-alpine AS runtime
WORKDIR /app

# wget for the HEALTHCHECK below. node:22-alpine does NOT include it by
# default, so we install it explicitly.
RUN apk add --no-cache wget

# Create uploads directory under workdir to avoid permission friction,
# and ensure node has ownership of /app and /app/uploads
RUN mkdir -p /app/uploads && chown -R node:node /app /app/uploads

# Drop root early so that all subsequent commands run as the unprivileged node user,
# guaranteeing all node_modules files are owned by node.
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node entrypoint.sh ./entrypoint.sh

# Ensure entrypoint is executable
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000

# The HEALTHCHECK hits the basic /health endpoint (liveness). The
# orchestrator should use /health/ready (deep readiness) for traffic
# routing — Docker's healthcheck is liveness-only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/index.js"]
