# ─── deps: node_modules, no Chromium ───
# Puppeteer's bundled Chromium is skipped (PUPPETEER_SKIP_DOWNLOAD=true);
# the runner stage installs system Chromium from apt and points Puppeteer
# at it via PUPPETEER_EXECUTABLE_PATH. Same pattern as PVG.
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 may need to compile from source if no prebuilt binary
# matches; python3/make/g++ cover that fallback path.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ─── builder: build client (Vite) + bundle server (esbuild) ───
FROM deps AS builder
WORKDIR /app
COPY . .
RUN npm run build && npm prune --omit=dev

# ─── runner: Chromium + node + dist + pruned node_modules ───
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=5000
ENV DEBIAN_FRONTEND=noninteractive

# Chromium + the shared libs it needs + a baseline font set + dumb-init for
# proper signal handling as PID 1. Same package list PVG ships on Railway.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libdrm2 libxss1 \
    ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Run as root. The Railway Volume was originally created by the nixpacks
# build (which runs as root), so every file on /data is root-owned. Dropping
# to a non-root user here would leave the SQLite DB unreadable (WAL mode
# needs write access to .db-wal / .db-shm even for SELECTs → "attempt to
# write a readonly database"). Inside an isolated Railway container with a
# tenant-scoped volume, the security cost of running as root is marginal.
RUN mkdir -p /data /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 5000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.cjs"]
