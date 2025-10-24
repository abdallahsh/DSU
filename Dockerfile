### Lightweight Dockerfile (Node + headless Chromium) for t2.micro

FROM node:18-alpine

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install minimal runtime deps including Chromium for headless mode
RUN apk add --no-cache \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont \
  wget

# Copy package files first to leverage cache
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application sources
COPY . .

# Create a non-root user and set ownership
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
  chown -R appuser:appgroup /usr/src/app

USER appuser

# Environment variables for Puppeteer/Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV HEADLESS=true
ENV NODE_OPTIONS="--max-old-space-size=512"

# Persistent browser profile
VOLUME ["/usr/src/app/user_data"]

# Expose application port (adjust if your app uses a different port)
EXPOSE 3000

# Start the app
CMD ["node", "app.js"]
