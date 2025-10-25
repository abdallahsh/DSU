### Dockerfile with Xvfb support for headless browser
FROM node:18-slim

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install Chromium and Xvfb
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xauth \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first to leverage cache
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application sources
COPY . .

# Create a non-root user and set ownership
RUN useradd -m -d /home/appuser -s /bin/bash appuser && \
    chown -R appuser:appuser /usr/src/app

# Create and set permissions for user_data directory
RUN mkdir -p /usr/src/app/user_data && \
    chown -R appuser:appuser /usr/src/app/user_data && \
    chmod 755 /usr/src/app/user_data

USER appuser

# Environment variables for Puppeteer/Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV DISPLAY=:99
ENV NODE_OPTIONS="--max-old-space-size=512"

# Persistent browser profile
VOLUME ["/usr/src/app/user_data"]

# Setup entrypoint
COPY --chown=appuser:appuser docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
