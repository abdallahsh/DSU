import { connect } from 'puppeteer-real-browser';
import { config } from '../utils/config.js';
import { logger, delay, browserUtils, isEC2 } from '../utils/common.js';
import path from 'path';
import fs from 'fs';

export class BrowserService {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
        this.isScraping = false;
        this.userDataDir = this.ensureUserDataDir();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
    }

    ensureUserDataDir() {
        const userDataDir = path.join(process.cwd(), config.browser.userDataDir);
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        // Clear user data if running on EC2 to prevent stale sessions
        if (isEC2() && fs.existsSync(userDataDir)) {
            try {
                fs.rmSync(userDataDir, { recursive: true, force: true });
                fs.mkdirSync(userDataDir, { recursive: true });
                logger.info('Cleared browser user data directory for fresh session');
            } catch (error) {
                logger.warn('Failed to clear browser user data:', error);
            }
        }
        return userDataDir;
    }

    async initialize() {
        try {
            const browserConfig = {
                args: [
                    ...config.browser.args,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                ],
                headless:true,
                turnstile: true,
                customConfig: {
                    ignoreDefaultArgs: ['--enable-automation'],
                    userDataDir: this.userDataDir
                },
                connectOption: {
                    ...config.browser.connectOptions,
                    timeout: 120000, // Increased timeout for EC2
                }
            };

            const { page, browser } = await connect(browserConfig);

            this.browser = browser;
            this.page = page;

            await this.setupPage(page);
            logger.info('Browser initialized successfully');

            // Set up error handlers
            this.setupErrorHandlers(page, browser);

            return true;
        } catch (error) {
            logger.error('Browser initialization failed', error);
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                logger.info(`Retrying browser initialization (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                await delay(5000);
                return this.initialize();
            }
            throw error;
        }
    }

    setupErrorHandlers(page, browser) {
        page.on('error', error => {
            logger.error('Page crashed:', error);
            this.handlePageError(error).catch(e => logger.error('Error recovery failed:', e));
        });

        page.on('requestfailed', request => {
            const failure = request.failure();
            if (failure && failure.errorText !== 'net::ERR_ABORTED') {
                logger.warn(`Request failed: ${request.url()} - ${failure.errorText}`);
            }
        });

        browser.on('disconnected', () => {
            logger.error('Browser disconnected');
            this.handleBrowserDisconnect().catch(e => logger.error('Reconnection failed:', e));
        });
    }

    async handlePageError(error) {
        if (!this.page || !this.browser) return;

        try {
            const isResponsive = await this.page.evaluate(() => true).catch(() => false);
            if (!isResponsive) {
                logger.info('Page unresponsive, creating new page...');
                await this.page.close().catch(() => {});
                this.page = await this.browser.newPage();
                await this.setupPage(this.page);
            }
        } catch (recoveryError) {
            logger.error('Page recovery failed:', recoveryError);
            throw recoveryError;
        }
    }

    async handleBrowserDisconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            throw new Error('Max reconnection attempts reached');
        }

        try {
            this.reconnectAttempts++;
            logger.info(`Attempting to reconnect browser (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            await this.initialize();
        } catch (error) {
            logger.error('Browser reconnection failed:', error);
            throw error;
        }
    }

    async setupPage(page) {
        await page.setDefaultTimeout(config.browser.defaultTimeout);
        await page.setDefaultNavigationTimeout(config.browser.navigationTimeout);
        await page.setUserAgent(config.browser.userAgent);
    }

    async extractUrls() {
        try {
            logger.info('Starting URL extraction process...');
            
            // Wait for either job cards or job links to appear with a longer timeout
            const jobElementPromises = [
                this.page.waitForSelector('[data-test="job-tile"]', { 
                    timeout: 30000,
                    visible: true 
                }).catch(() => null),
                this.page.waitForSelector('a[href*="/jobs/"]', { 
                    timeout: 30000,
                    visible: true 
                }).catch(() => null)
            ];
            
            const results = await Promise.all(jobElementPromises);
            if (!results[0] && !results[1]) {
                logger.warn('No job elements found on the page');
                // Validate if we're actually on the correct page
                const currentUrl = await this.page.url();
                logger.debug('Current URL:', currentUrl);
                return [];
            }
            
            // Additional delay to ensure dynamic content is loaded
            await browserUtils.randomDelay(2000, 3000);
            
            // Extract urls using multiple selector strategies with visited state check
            const urls = await this.page.evaluate(() => {
                const jobLinks = new Set();
                
                const isVisited = (element) => {
                    if (!element) return false;
                    
                    // Check element and its parents for visited state
                    let current = element;
                    while (current) {
                        // Check for visited class
                        if (current.classList && (
                            current.classList.contains('visited') ||
                            current.classList.contains('air3-visited') ||
                            current.classList.contains('up-visited')
                        )) return true;
                        
                        // Check for visited data attribute
                        if (current.dataset && (
                            current.dataset.visited === 'true' ||
                            current.dataset.state === 'visited'
                        )) return true;
                        
                        // Check for visited in class string
                        if (current.className && 
                            typeof current.className === 'string' && 
                            current.className.includes('visited')) return true;
                        
                        current = current.parentElement;
                    }
                    return false;
                };
                
                // Strategy 1: Direct job links
                document.querySelectorAll('a[href*="/jobs/"]').forEach(link => {
                    if (link.href && 
                        link.href.includes('/jobs/') && 
                        !link.href.includes('/nx/search/jobs/') &&
                        !link.href.endsWith('/jobs/') &&
                        link.href.includes('~') &&
                        !isVisited(link)) {
                        jobLinks.add(link.href);
                    }
                });
                
                // Strategy 2: Job cards with visited state check
                document.querySelectorAll('[data-test="job-tile"]').forEach(card => {
                    if (!isVisited(card)) {
                        const link = card.querySelector('a[href*="/jobs/"]');
                        if (link && link.href && 
                            link.href.includes('~') && 
                            !isVisited(link)) {
                            jobLinks.add(link.href);
                        }
                    }
                });
                
                // Strategy 3: Job title links with visited state check
                document.querySelectorAll('[data-test="job-title-link"]').forEach(link => {
                    const card = link.closest('[data-test="job-tile"]');
                    if (link.href && 
                        link.href.includes('~') && 
                        !isVisited(link) && 
                        (!card || !isVisited(card))) {
                        jobLinks.add(link.href);
                    }
                });

                return Array.from(jobLinks);
            });

            logger.info(`Found ${urls.length} job URLs`);
            logger.debug('Sample URLs:', urls.slice(0, 3));
            return urls;
            
        } catch (error) {
            logger.error('Error during URL extraction:', error);
            if (error.name === 'TimeoutError') {
                logger.error('Timeout waiting for job cards to appear. The page might not have loaded completely.');
            }
            return [];
        }
    }




    async navigateToUrl(url, options = {}) {
        let retries = 0;
        while (retries < config.scraper.maxRetries) {
            try {
                // Always use 'domcontentloaded' for navigation for speed and Cloudflare compatibility
                const navigationOptions = {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                    ...options
                };

                await this.page.goto(url, navigationOptions);

                // If jobs/search page, wait extra for Cloudflare verification
                if (url.includes('/jobs/') || url.includes('/search/')) {
                    logger.info('Waiting for Cloudflare verification to complete...');
                    await browserUtils.randomDelay(
                        config.scraper.cloudflareDelay?.min || 3000,
                        config.scraper.cloudflareDelay?.max || 7000
                    );
                }

                // Wait for critical elements with a reasonable timeout
                try {
                    await this.page.waitForFunction(() => {
                        if (document.readyState !== 'complete') return false;
                        const mainContent = document.body.textContent?.length > 0;
                        if (!mainContent) return false;
                        const loadingElements = document.querySelectorAll(
                            '.air3-loader, .air3-spinner, [data-test="loading"], .loading'
                        );
                        return loadingElements.length === 0;
                    }, {
                        timeout: 20000,
                        polling: 1000
                    });
                } catch (contentError) {
                    logger.warn('Content loading timeout - will attempt to continue');
                }

                await browserUtils.randomDelay(1000, 3000);

                // Validate the page content for jobs/search
                if (url.includes('/jobs/') || url.includes('/search/')) {
                    const isValid = await this.validateJobsPage();
                    if (!isValid) {
                        logger.warn('Page validation failed - will retry navigation');
                        throw new Error('Invalid page state after navigation');
                    }
                }

                return true;
            } catch (error) {
                retries++;
                logger.error(`Navigation failed (attempt ${retries}/${config.scraper.maxRetries})`, error);
                if (retries < config.scraper.maxRetries) {
                    // Try to recover from various error states
                    try {
                        const isResponsive = await this.page.evaluate(() => true).catch(() => false);
                        if (!isResponsive) {
                            logger.warn('Page is unresponsive, recreating page...');
                            await this.page.close().catch(() => {});
                            this.page = await this.browser.newPage();
                            await this.setupPage(this.page);
                        } else {
                            await this.page.reload({ 
                                waitUntil: 'domcontentloaded',
                                timeout: 30000 
                            });
                        }
                    } catch (recoveryError) {
                        logger.error('Recovery attempt failed:', recoveryError);
                    }
                    logger.info(`Waiting before retry...`);
                    await browserUtils.randomDelay(1000, 5000);
                    continue;
                }
                throw error;
            }
        }
        return false;
    }
   async  scrollToAndClickElement(selector) {
        try {
            // First wait for the element to be present in DOM
            await this.page.waitForSelector(selector, {
                timeout: config.browser.defaultTimeout
            });

            // Get element and check if it's visible
            const element = await this.page.$(selector);
            if (!element) {
                logger.warn(`Element not found: ${selector}`);
                return false;
            }

            // Get element position
            const box = await element.boundingBox();
            if (!box) {
                logger.warn(`Element has no bounding box: ${selector}`);
                return false;
            }

            // Scroll into view with center alignment
            await this.page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) {
                    el.scrollIntoView({
                        behavior: 'instant',
                        block: 'center',
                        inline: 'center'
                    });
                }
            }, selector);

            // Brief pause for scroll to complete and page to stabilize
            await browserUtils.randomDelay(500, 1000);

            // Check visibility again after scroll
            const isVisible = await this.page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && 
                       style.visibility !== 'hidden' && 
                       style.opacity !== '0';
            }, selector);

            if (!isVisible) {
                logger.warn(`Element not visible after scroll: ${selector}`);
                return false;
            }

            // Click with a human-like delay
            await element.click({ delay: browserUtils.randomInt(50, 150) });
            return true;

        } catch (error) {
            logger.error(`Error in scrollToAndClickElement for ${selector}:`, error);
            return false;
        }
    }


    


    async login(page) {
        let retries = 0;
        while (retries < config.scraper.maxRetries) {
            try {
                // Clear cookies before login attempt
                await page.cookies().then(cookies => 
                    Promise.all(cookies.map(cookie => 
                        page.deleteCookie(cookie)))
                ).catch(e => logger.warn('Failed to clear cookies:', e));

                await this.navigateToUrl(config.browser.loginUrl, {
                    waitUntil: 'networkidle0',
                    timeout: isEC2() ? 120000 : config.browser.defaultTimeout
                });

                // Wait for and enter email
                logger.info('Entering email...');
                const emailInput = await page.waitForSelector(config.selectors.login.emailInput, { 
                    visible: true,
                    timeout: 30000
                });
                if (!emailInput) throw new Error('Email input not found');
                await emailInput.click({ clickCount: 3 });
                await emailInput.press('Backspace');
                await page.type(config.selectors.login.emailInput, config.browser.email, { delay: 10 });
                await browserUtils.randomDelay(1000, 2000);

                // Click continue after email
                logger.info('Clicking continue after email...');
                await page.click(config.selectors.login.continueButton);

                // Wait for password field, with extra checks and debug
                logger.info('Waiting for password field...');
                let passwordInput = null;
                try {
                    passwordInput = await page.waitForSelector(config.selectors.login.passwordInput, { 
                        visible: true,
                        timeout: 30000 
                    });
                } catch (pwErr) {
                    logger.error('Password field not found after email submit:', pwErr);
                    // Check for error messages on the page
                    const errorMsg = await page.evaluate(() => {
                        const err = document.querySelector('.error, .alert, .up-error, [role="alert"]');
                        return err ? err.textContent : null;
                    });
                    if (errorMsg) {
                        logger.warn('Login page error message:', errorMsg);
                    }
                    // Screenshot for debugging
                    try {
                        await page.screenshot({ path: `login_error_${Date.now()}.png` });
                        logger.info('Saved screenshot of login error');
                    } catch (ssErr) {
                        logger.warn('Failed to save screenshot:', ssErr);
                    }
                    // Log a snippet of the page content for debugging
                    const pageContent = await page.content();
                    logger.debug('Login page HTML snippet:', pageContent.slice(0, 500));
                    throw pwErr;
                }
                if (!passwordInput) throw new Error('Password input not found');
                await passwordInput.click({ clickCount: 3 });
                await passwordInput.press('Backspace');
                await page.type(config.selectors.login.passwordInput, config.browser.password, { delay: 10 });
                await browserUtils.randomDelay(1000, 2000);

                // Click login
                logger.info('Completing login...');
                await page.click(config.selectors.login.submitButton);

                // Wait for navigation or error
                logger.info('Waiting for login completion...');
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }),
                    page.waitForSelector('.error, .alert, .up-error, [role="alert"]', { timeout: 60000 }).catch(() => null)
                ]);
                await browserUtils.randomDelay(1000, 2000);

                // Check for login error message after submit
                const loginError = await page.evaluate(() => {
                    const err = document.querySelector('.error, .alert, .up-error, [role="alert"]');
                    return err ? err.textContent : null;
                });
                if (loginError) {
                    logger.warn('Login failed, error message:', loginError);
                    throw new Error('Login error: ' + loginError);
                }

                // Verify login success
                logger.info('Verifying login...');
                const isLoggedIn = await page.evaluate((selector) => {
                    return !document.querySelector(selector);
                }, config.selectors.login.loginButton);

                if (!isLoggedIn) {
                    throw new Error('Login failed - still on login page');
                }

                logger.info('Login successful');
                return true;

            } catch (error) {
                retries++;
                logger.error(`Login failed (attempt ${retries}/${config.scraper.maxRetries})`, error);
                if (retries < config.scraper.maxRetries) {
                    await browserUtils.randomDelay(config.scraper.retryDelay, config.scraper.retryDelay * 2);
                    continue;
                }
                // Final debug: screenshot and page content
                try {
                    await page.screenshot({ path: `login_final_error_${Date.now()}.png` });
                    logger.info('Saved final screenshot of login error');
                } catch (ssErr) {
                    logger.warn('Failed to save final screenshot:', ssErr);
                }
                const pageContent = await page.content();
                logger.debug('Final login page HTML snippet:', pageContent.slice(0, 1000));
                return false;
            }
        }
        return false;
    }

    async validateJobsPage() {
        try {
            const pageValidation = await this.page.evaluate(() => {
                // Check for common job page indicators
                const hasJobTiles = document.querySelectorAll('[data-test="job-tile"]').length > 0;
                const hasJobLinks = document.querySelectorAll('a[href*="/jobs/"]').length > 0;
                const hasSearchResults = document.querySelectorAll('[data-test="job-search-results"], .job-search-results').length > 0;
                
                return {
                    hasJobTiles,
                    hasJobLinks,
                    hasSearchResults,
                    url: window.location.href
                };
            });

            if (!pageValidation.hasJobTiles && !pageValidation.hasJobLinks && !pageValidation.hasSearchResults) {
                logger.warn('Page validation failed - no job elements found');
                logger.debug('Current URL:', pageValidation.url);
                return false;
            }
            return true;
        } catch (error) {
            logger.error('Error validating jobs page:', error);
            return false;
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.disconnect();
            this.browser = null;
            this.page = null;
        }
    }
}

export default BrowserService;
