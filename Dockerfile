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

# Non-root user; /data is where Railway's Volume gets mounted (the
# getDataDir() resolver writes the SQLite DB there).
RUN groupadd -r app && useradd -r -g app -G audio,video app \
  && mkdir -p /data /app && chown -R app:app /data /app

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./package.json

USER app
EXPOSE 5000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.cjs"]
