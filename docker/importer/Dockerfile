FROM node:20-bullseye AS deps
WORKDIR /app

# Install small set of build deps for native modules if required
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# Allow build to control whether devDependencies are installed
ARG INSTALL_DEV=false
# Install deps — by default omit dev deps for a smaller image
RUN if [ "${INSTALL_DEV}" = "true" ]; then \
      npm ci --no-audit --no-fund ; \
    else \
      npm ci --omit=dev --no-audit --no-fund ; \
    fi

FROM node:20-slim AS runner
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY scripts ./scripts

# The importer image's entire purpose is to run scripts/setup-db.mjs
ENTRYPOINT ["node", "scripts/setup-db.mjs"]
CMD ["--help"]
