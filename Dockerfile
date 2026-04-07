# ─────────────────────────────────────────────────────────────────────────────
# HireIQ — Multi-stage Docker build
# Stage 1: Build the React frontend
# Stage 2: Production Node.js image with built frontend served by Express
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Frontend build ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy dependency manifests first (layer cache)
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps --prefer-offline

# Copy source and build
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production runtime ──────────────────────────────────────────────
FROM node:22-alpine AS production

# Security: run as non-root
RUN addgroup -S hireiq && adduser -S hireiq -G hireiq

WORKDIR /app

# Install backend production dependencies only
COPY backend/package*.json ./
RUN npm ci --omit=dev --prefer-offline

# Copy backend source
COPY backend/ ./

# Copy built frontend from stage 1 into the location Express expects
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Persistent data volume mount point
# All SQLite databases (master.db + per-tenant DBs) live here
RUN mkdir -p /data && chown hireiq:hireiq /data

# Uploads directory
RUN mkdir -p /data/uploads && chown hireiq:hireiq /data/uploads

# Switch to non-root user
USER hireiq

# Environment defaults (override at runtime via platform env vars)
ENV NODE_ENV=production \
    PORT=3001 \
    HIREIQ_DATA_DIR=/data \
    HIREIQ_DB_PATH=/data/hireiq.db

EXPOSE 3001

# Health check — Railway/Render use this to determine container readiness
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server.js"]
