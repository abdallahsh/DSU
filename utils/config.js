import dotenv from 'dotenv';
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    username: process.env.REDIS_USERNAME || '',
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB) || 0,
    keyPrefix: isProd ? 'prod:genie:scraped:' : 'dev:genie:scraped:',
    jobBatchSize: isProd ? 10 : 5, // Increased batch size for production
    // Connection settings for production
    tls: isProd ? { rejectUnauthorized: false } : undefined,
    retryStrategy: (times) => Math.min(times * 200, 3000),
    maxRetriesPerRequest: isProd ? 5 : 3,
  },
  browser: {
    chromePath: isProd ? '/usr/bin/google-chrome' : process.env.CHROME_PATH,
    userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    baseUrl: 'https://www.upwork.com',
    loginUrl: 'https://www.upwork.com/ab/account-security/login',
    jobsUrl: 'https://www.upwork.com/nx/search/jobs/?client_hires=1-9,10-&per_page=20&sort=recency',
    email: process.env.UPWORK_EMAIL || process.env.EMAIL,
    password: process.env.UPWORK_PASSWORD || process.env.PASSWORD,
    args: [
      "--no-sandbox", // Required for running Chrome in Linux without sandbox
      "--disable-setuid-sandbox", // Required for running Chrome in Linux
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--disable-notifications",
      "--disable-infobars",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
      "--window-size=1920,1080",
      "--ignore-certificate-errors",
      "--ignore-certificate-errors-spki-list",
      ...(isProd ? ["--headless=new"] : []), // Use headless in production
    ],
    defaultTimeout: isProd ? 45000 : 60000,
    navigationTimeout: isProd ? 60000 : 90000,
    connectOptions: {
      defaultViewport: null,
      timeout: isProd ? 90000 : 120000,
      protocolTimeout: 60000,
    },
    userDataDir: isProd ? '/home/ec2-user/app/user_data' : './user_data',
    headless: isProd ? true : process.env.HEADLESS === 'false',
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