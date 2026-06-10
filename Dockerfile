# Production Dockerfile for the Themison FE.
# Two-stage build:
#   - builder: install all deps, run `pnpm build`
#       -> client bundle:  dist/public/  (vite)
#       -> server bundle:  dist/index.js (esbuild)
#   - runtime: install production deps only, copy dist/, run node directly
# The Express server (dist/index.js) serves both the static client and the
# /api/* tRPC routes from a single Node process.

# ─────────────────────────────────────────
# Stage 1: builder
# ─────────────────────────────────────────
FROM node:22-alpine AS builder

# corepack ships with Node 22 but is disabled by default. Pin the same
# pnpm version the lockfile was generated with.
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# Install deps first for layer caching.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Vite inlines env vars matching `envPrefix` (VITE_/AUTH0_) at build time.
# Surface them as build ARGs so the caller (docker-compose or Render) can
# pass through the right values for that environment.
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
ARG VITE_AUTH0_REDIRECT_URI
ARG VITE_APP_ID
ARG VITE_OAUTH_PORTAL_URL
ENV VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN
ENV VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID
ENV VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE
ENV VITE_AUTH0_REDIRECT_URI=$VITE_AUTH0_REDIRECT_URI
ENV VITE_APP_ID=$VITE_APP_ID
ENV VITE_OAUTH_PORTAL_URL=$VITE_OAUTH_PORTAL_URL

# Disable Manus runtime plugins in built bundles. Their capture-phase
# session-replay listeners eat clicks/keystrokes when the telemetry
# endpoint is unreachable (which it always is outside the Manus platform),
# leaving the UI feeling frozen.
ENV DISABLE_MANUS_RUNTIME=true

# Copy source and build.
COPY . .
RUN pnpm build

# ─────────────────────────────────────────
# Stage 2: runtime
# ─────────────────────────────────────────
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# Install only production deps. Saves ~200MB vs the builder image
# because dev-only deps (vite, esbuild, drizzle-kit, etc.) are skipped.
# esbuild was built with `--packages=external`, so node_modules is needed
# at runtime — that's why we install instead of just copying dist/.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod

# Built artifacts from the builder stage.
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
# server/_core/index.ts reads PORT from env and falls back to 3000.
# Render overrides this with a dynamic value at deploy time.
ENV PORT=3000
EXPOSE 3000

# Run the bundled server directly. No pnpm wrapper = faster startup,
# correct signal handling for graceful shutdown.
CMD ["node", "dist/index.js"]
