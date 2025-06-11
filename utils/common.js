export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Logging utility for consistent logging across the application
export const logger = {
  info: (message) => {
    console.log(`[DSU] ${message}`);
  },
  declar: (message) => {
    console.log(`[DSU] 📝 ${message}`);
  },
  success: (message) => {
    console.log(`[DSU] ✔️ ${message}`);
  },
  failure: (message) => {
    console.error(`[DSU] ❌ ${message}`);
  },


  error: (message, error = null) => {
    if (error) {
      console.error(`[DSU] ${message}:`, error.message);
      if (error.stack) {
        console.error(`[DSU] Error details:`, error.stack);
      }
    } else {
      console.error(`[DSU] ${message}`);
    }
  },
  warn: (message) => {
    console.warn(`[DSU] ${message}`);
  },
  debug: (message) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DSU-DEBUG] ${message}`);
    }
  },
  summary: (title, data) => {
    console.log(`
[DSU] ===== ${title} =====
${Object.entries(data).map(([key, value]) => `[DSU] ${key}: ${value}`).join('\n')}
[DSU] ====================
    `);
  }
};

// Browser utility functions
export const browserUtils = {
  async moveMouseLikeHuman(page, element) {
    const box = await element.boundingBox();
    if (!box) return;

    const mouse = page.mouse;
    const currentPos = await page.evaluate(() => ({
      x: window.mouseX || 0,
      y: window.mouseY || 0
    }));

    const targetX = box.x + box.width / 2 + (Math.random() * 10 - 5);
    const targetY = box.y + box.height / 2 + (Math.random() * 10 - 5);

    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const x = currentPos.x + (targetX - currentPos.x) * progress;
      const y = currentPos.y + (targetY - currentPos.y) * progress;
      await mouse.move(x, y);
      await delay(50 + Math.random() * 50);
    }
  },

  async randomDelay(min = 1000, max = 3000) {
    const waitTime = Math.floor(Math.random() * (max - min + 1)) + min;
    await delay(waitTime);
  },

  async simulateScrolling(page) {
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    let currentPosition = 0;
    while (currentPosition < documentHeight) {
      const scrollAmount = Math.floor(100 + Math.random() * 200);
      currentPosition += scrollAmount;
      await page.evaluate((pos) => {
        window.scrollTo({
          top: pos,
          behavior: 'smooth'
        });
      }, currentPosition);
      await delay(500 + Math.random() * 1000);
    }
  },
  async randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
};
