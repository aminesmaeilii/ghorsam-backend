# Ghorsam (قرصام) — single image serving both the API and the Mini App's
# static frontend (./public) from one process. See README.md for the env
# vars this needs at runtime and why DATA_DIR must point at a mounted
# persistent volume in production.

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
# Default mount point for a persistent volume. Override with a different
# path if your platform mounts the volume elsewhere.
ENV DATA_DIR=/data

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

# --experimental-sqlite is a no-op on Node versions where node:sqlite no
# longer needs it, and required on others — always pass it for portability.
CMD ["node", "--experimental-sqlite", "server.js"]
