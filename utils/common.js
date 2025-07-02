// Delay utility
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Logging utility for consistent logging across the application
export const logger = {
  info: (message, ...args) => console.log(`[DSU] ${message}`, ...args),
  declar: (message, ...args) => console.log(`[DSU] 📝 ${message}`, ...args),
  success: (message, ...args) => console.log(`[DSU] ✔️ ${message}`, ...args),
  failure: (message, ...args) => console.error(`[DSU] ❌ ${message}`, ...args),
  error: (message, error = null) => {
    if (error) {
      console.error(`[DSU] ${message}:`, error.message || error);
      if (error.stack) {
        console.error(`[DSU] Error details:`, error.stack);
      }
    } else {
      console.error(`[DSU] ${message}`);
    }
  },
  warn: (message, ...args) => console.warn(`[DSU] ${message}`, ...args),
  debug: (message, ...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DSU-DEBUG] ${message}`, ...args);
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
    // Move mouse in a straight line with random jitter
    const steps = 10;
    const start = await page.evaluate(() => ({ x: window.mouseX || 0, y: window.mouseY || 0 }));
    const targetX = box.x + box.width / 2 + (Math.random() * 10 - 5);
    const targetY = box.y + box.height / 2 + (Math.random() * 10 - 5);
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const x = start.x + (targetX - start.x) * progress;
      const y = start.y + (targetY - start.y) * progress;
      await mouse.move(x, y);
      await delay(50 + Math.random() * 50);
    }
  },

  async randomDelay(min = 1000, max = 3000) {
    const waitTime = browserUtils.randomInt(min, max);
    await delay(waitTime);
  },

  async simulateScrolling(page, stepMin = 100, stepMax = 200) {
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    let currentPosition = 0;
    while (currentPosition < documentHeight) {
      const scrollAmount = browserUtils.randomInt(stepMin, stepMax);
      currentPosition += scrollAmount;
      await page.evaluate(pos => window.scrollTo({ top: pos, behavior: 'smooth' }), currentPosition);
      await delay(500 + Math.random() * 1000);
    }
  },

  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
};

// Environment/EC2/CI helpers
export const isEC2 = () => {
  // AWS EC2 instances have the EC2 metadata endpoint available
  // This is a simple check, for more robust detection use the AWS SDK or check /sys/hypervisor/uuid
  return process.env.EC2 || process.env.AWS_EXECUTION_ENV || false;
};

export const isCI = () => {
  // Common CI/CD environment variables
  return !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI);
};
