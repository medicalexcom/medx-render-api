# Lightweight Node base
FROM node:20-slim

# System deps required by headless Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libxss1 libasound2 fonts-liberation libatk-bridge2.0-0 \
    libatk1.0-0 libgtk-3-0 libdrm2 libgbm1 libx11-xcb1 \
    ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install JS deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Install Chromium that Playwright controls (and its extra deps)
RUN npx playwright install --with-deps chromium

# App code
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080

# Play nicely on Render
CMD ["node", "server.js"]
