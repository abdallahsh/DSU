import { connect } from 'puppeteer-real-browser';
import { config } from '../utils/config.js';
import { logger, delay, browserUtils } from '../utils/common.js';
import path from 'path';
import fs from 'fs';

export class BrowserService {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
        this.isScraping = false;
        this.userDataDir = this.ensureUserDataDir();
    }

    ensureUserDataDir() {
        const userDataDir = path.join(process.cwd(), config.browser.userDataDir);
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        return userDataDir;
    }
    //

    async initialize() {
        try {
            const { page, browser } = await connect({
                args: config.browser.args,
                headless: true,
                turnstile: true,
                customConfig: {
                    ignoreDefaultArgs: ['--enable-automation'],
                    userDataDir: this.userDataDir
                },
                connectOption: config.browser.connectOptions
            });

            this.browser = browser;
            this.page = page;

            await this.setupPage(page);
            logger.info('Browser initialized successfully');
            return true;
        } catch (error) {
            logger.error('Browser initialization failed', error);
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
                // First attempt with just domcontentloaded for faster initial load
                const navigationOptions = {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                    ...options
                };

                // Navigate to page
                await this.page.goto(url, navigationOptions);
                
                // Wait for network to settle with a separate timeout
                try {
                    await this.page.waitForNavigation({ 
                        waitUntil: 'networkidle0',
                        timeout: 30000
                    }).catch(() => {
                        logger.debug('Network did not reach idle state - continuing anyway');
                    });
                } catch (networkError) {
                    logger.debug('Network timeout occurred, but page might be usable');
                }
                
                
                // Wait for critical elements with a reasonable timeout
                try {
                    await this.page.waitForFunction(() => {
                        // Check document readyState
                        if (document.readyState !== 'complete') return false;
                        
                        // Basic content check
                        const mainContent = document.body.textContent?.length > 0;
                        if (!mainContent) return false;
                        
                        // Check for any loading indicators
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

                await browserUtils.randomDelay(2000, 3000);
                
                // Validate the page content
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
                        // Check if page is still responsive
                        const isResponsive = await this.page.evaluate(() => true).catch(() => false);
                        
                        if (!isResponsive) {
                            logger.warn('Page is unresponsive, recreating page...');
                            await this.page.close().catch(() => {});
                            this.page = await this.browser.newPage();
                            await this.setupPage(this.page);
                        } else {
                            // Try a simple reload first
                            await this.page.reload({ 
                                waitUntil: ['domcontentloaded', 'networkidle0'],
                                timeout: 30000 
                            });
                        }
                    } catch (recoveryError) {
                        logger.error('Recovery attempt failed:', recoveryError);
                        // If recovery fails, we'll still retry the navigation
                    }
                    
                    
                    logger.info(`Waiting before retry...`);
                    await browserUtils.randomDelay(2000, 5000);
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
                await page.goto(config.browser.loginUrl, { 
                    waitUntil: 'networkidle0', 
                    timeout: 60000 
                });

                // Handle email input
                logger.info('Entering email...');
                await page.waitForSelector(config.selectors.login.emailInput, { visible: true });
                await page.type(config.selectors.login.emailInput, config.browser.email, { delay: 10 });
                await browserUtils.randomDelay(2000, 4000);

                // Click continue after email
                logger.info('Clicking continue after email...');
                await page.click(config.selectors.login.continueButton);
                
                // Wait for password field
                logger.info('Waiting for password field...');
                await page.waitForSelector(config.selectors.login.passwordInput, { 
                    visible: true,
                    timeout: 30000 
                });
                
                // Type password
                logger.info('Entering password...');
                await page.type(config.selectors.login.passwordInput, config.browser.password, { delay: 10 });
                await browserUtils.randomDelay(2000, 4000);

                // Click login
                logger.info('Completing login...');
                await page.click(config.selectors.login.submitButton);
                
                // Wait for navigation
                logger.info('Waiting for login completion...');
                await page.waitForNavigation({ 
                    waitUntil: 'networkidle0',
                    timeout: 60000
                }).catch(() => logger.warn('Navigation timeout - continuing anyway'));

                await browserUtils.randomDelay(2000, 4000);

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
