# Masjid Pulse - single container (API + admin + TV). Data (SQLite + slide uploads) lives in /data:
# mount a persistent volume there (Fly volume, Render disk, Railway volume, `docker run -v`).
#
#   docker build -t masjid-pulse .
#   docker run -p 8080:8080 -v masjid-data:/data -e JWT_SECRET=$(openssl rand -hex 32) \
#     -e APP_URL=http://localhost:8080 masjid-pulse

# ---- build: compile TS, bundle the ES5 TV app, then drop dev dependencies ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Toolchain only used if better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_FILE=/data/masjid-pulse.db \
    UPLOAD_DIR=/data/uploads \
    TRUST_PROXY=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
# Runs as root so it can write to freshly mounted platform volumes (they are root-owned on Fly,
# Render and Railway). The container itself is the isolation boundary.
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
