import dotenv from 'dotenv';
dotenv.config();

export const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    username: process.env.REDIS_USERNAME || '',
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB) || 0,
    keyPrefix: 'genie:scraped:',
    jobBatchSize: 5, // Number of jobs to process before saving to Redis
  },
  browser: {
    chromePath: process.env.CHROME_PATH,
    userAgent: process.env.USER_AGENT,
    viewport: { width: 1280, height: 800 },
    baseUrl: 'https://www.upwork.com',
    loginUrl: 'https://www.upwork.com/ab/account-security/login',
    jobsUrl: 'https://www.upwork.com/nx/search/jobs/?client_hires=1-9,10-&per_page=20&sort=recency',
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    args: [
      "--start-maximized",
      "--disable-notifications",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--disable-infobars",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
    ],
    defaultTimeout: 60000,
    navigationTimeout: 90000,
    connectOptions: {
      defaultViewport: null,
      timeout: 120000
    },
    userDataDir: './user_data',
    // Make headless default to true unless explicitly set to 'false'
    headless: process.env.HEADLESS !== 'false',
  },
  scraper: {
    maxRetries: 3,
    retryDelay: 5000,
    jobProcessingDelay: {
      min: 4000,
      max: 9000
    },
    pageRefreshDelay: {
      min: 5000,
      max: 10000
    },
    cloudflareDelay: {
      min: 2000,
      max: 4000
    }
  },
  selectors: {
    login: {
      loginButton: 'a[href="/ab/account-security/login"]',
      emailInput: 'input[name="login[username]"]',
      passwordInput: 'input[name="login[password]"]',
      continueButton: '#login_password_continue',
      submitButton: '#login_control_continue'
    },
    jobs: {
      jobTile: 'article[data-test="JobTile"]',
      jobLink: 'a[data-test="job-tile-title-link"], a[data-test="job-tile-title-link UpLink"]',
      applyButton: 'button[data-cy="submit-proposal-button"]',
      closeModal: 'div[data-test="UpCIcon"].air3-slider-prev-icon'
    }
  }
};