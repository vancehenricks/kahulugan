FROM node:20-bullseye AS deps
WORKDIR /app

# Allow the build to control whether devDependencies are installed in the deps stage.
# This is controlled via the build arg INSTALL_DEV (true|false). Default is false
# so images built for production will not include devDependencies.
ARG INSTALL_DEV=false
# Install build-time dependencies required by some native modules (keep minimal)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential python3 pkg-config ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# Use npm ci and make installing devDependencies optional via INSTALL_DEV.
# If INSTALL_DEV=true then install dev deps (useful for local/dev builds), otherwise
# omit dev deps for a smaller production image.
RUN if [ "${INSTALL_DEV}" = "true" ]; then \
      npm ci --no-audit --no-fund ; \
    else \
      npm ci --omit=dev --no-audit --no-fund ; \
    fi

FROM node:20-bullseye AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN if [ -d client ]; then cd client && npm ci && npm run build; fi

RUN npm prune --production || true

FROM node:20-slim AS runner
WORKDIR /app


COPY --from=builder /app .
COPY docker/server/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh || true

RUN mkdir -p /app/data && chown node:node /app/data || true

EXPOSE 3000

USER node
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.mjs"]
