FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    DATA_DIR=/app/data \
    WWEBJS_AUTH_PATH=/app/data/.wwebjs_auth

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        dumb-init \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY . .

RUN mkdir -p /app/data/.wwebjs_auth /app/data/.wwebjs_cache \
    && rm -f /app/qr-code.png /app/qrcode.png \
    && chown -R node:node /app

USER node

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "healthcheck.js"]

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "web-setup.js"]
