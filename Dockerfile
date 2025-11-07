### Dockerfile with Xvfb support for headless browser
FROM node:18

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
RUN npm install --production

# Copy application sources
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
