# Production image for the new FE — builds the Vite client + esbuild server
# bundle, then serves them from the Express/tRPC host (`node dist/index.js`).
# The docker-compose `frontend` service builds from this file.
#
# For local dev with HMR use `Dockerfile.dev` instead.

FROM node:22-alpine

# corepack ships with Node 22 but is disabled by default. Pin pnpm to the
# version the repo committed so the lockfile is honoured.
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# --- Auth0 client config, baked into the client bundle at build time ---
# Vite only inlines VITE_*/AUTH0_* vars (see envPrefix in vite.config.ts).
# These are OPTIONAL build-arg overrides. When a build arg is empty (the
# default — compose passes them through unset), we must NOT export it as an
# env var, or the empty value would clobber the correct value baked into the
# repo's own `.env`. So we only write NON-EMPTY args to `.env.production.local`
# (highest Vite precedence); otherwise the committed `.env` wins.
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
ARG VITE_AUTH0_REDIRECT_URI
ARG VITE_APP_ID
ARG VITE_OAUTH_PORTAL_URL

# Install deps first for a cached layer. patches/ is referenced by the
# pnpm patchedDependencies field, so it must be present during install.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Copy the rest of the source (node_modules excluded via .dockerignore).
COPY . .

# Real production build. Set NODE_ENV=production AFTER `pnpm install` (so
# devDependencies were still installed) so the client is built in production
# mode and this also carries through to runtime.
ENV NODE_ENV=production

# IMPORTANT — the ARG lines above become environment variables inside this RUN.
# compose passes them EMPTY (VITE_* live in the FE's own .env, not compose), and
# Vite gives process.env HIGHER priority than .env files. So an empty
# VITE_AUTH0_DOMAIN env var would shadow the real value in `.env`, baking an
# empty Auth0 domain into the bundle (Sign-in then redirects to "https://authorize/").
# Fix: capture any NON-empty build-arg overrides into .env.production.local
# (highest Vite precedence), then `unset` the vars so Vite falls back to the
# committed `.env` for the rest. Then build: vite → dist/public, esbuild → dist/index.js.
RUN { \
      [ -n "$VITE_AUTH0_DOMAIN" ] && echo "VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN"; \
      [ -n "$VITE_AUTH0_CLIENT_ID" ] && echo "VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID"; \
      [ -n "$VITE_AUTH0_AUDIENCE" ] && echo "VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE"; \
      [ -n "$VITE_AUTH0_REDIRECT_URI" ] && echo "VITE_AUTH0_REDIRECT_URI=$VITE_AUTH0_REDIRECT_URI"; \
      [ -n "$VITE_APP_ID" ] && echo "VITE_APP_ID=$VITE_APP_ID"; \
      [ -n "$VITE_OAUTH_PORTAL_URL" ] && echo "VITE_OAUTH_PORTAL_URL=$VITE_OAUTH_PORTAL_URL"; \
      true; \
    } >> .env.production.local; \
    unset VITE_AUTH0_DOMAIN VITE_AUTH0_CLIENT_ID VITE_AUTH0_AUDIENCE \
          VITE_AUTH0_REDIRECT_URI VITE_APP_ID VITE_OAUTH_PORTAL_URL; \
    pnpm build

ENV PORT=3000
EXPOSE 3000

# `pnpm start` sets NODE_ENV=production then runs node dist/index.js; call
# node directly so SIGTERM reaches it for graceful shutdown.
CMD ["node", "dist/index.js"]
