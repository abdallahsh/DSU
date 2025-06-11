import { BrowserService } from './browser.service.js';
import { config } from '../utils/config.js';
import { logger, browserUtils } from '../utils/common.js';
import { cache } from '../utils/redis.cash.js';
import jobModalService from './jms.service.js';
import jobDirectService from './jds.service.js';

export class MainScraper extends BrowserService {
    constructor() {
        super();
        this.processedJobs = new Set();
        this.currentBatch = [];
    }

    async checkLoginStatus() {
        try {
            await browserUtils.randomDelay(1000, 2000);
            
            // Verify login using DOM checks
            const isLoggedIn = await this.page.evaluate((selector) => {
                return !document.querySelector(selector);
            }, config.selectors.login.loginButton);

            logger.info(`Login status check: ${isLoggedIn ? 'Logged in' : 'Not logged in'}`);
            this.isLoggedIn = isLoggedIn;
            return isLoggedIn;
        } catch (error) {
            logger.error('Error checking login status:', error);
            // On error, assume we're not logged in to be safe
            return false;
        }
    }

    async loginWithRetry() {
        let retries = 0;
        const maxRetries = config.scraper.maxRetries;
        
        while (retries < maxRetries) {
            try {
                // Try to login
                const success = await this.login(this.page);
                if (success) {
                    this.isLoggedIn = true;
                    return true;
                }

                logger.warn('Login verification failed, retrying...');
                retries++;
                await browserUtils.randomDelay(5000, 10000);

            } catch (error) {
                retries++;
                logger.error(`Login attempt ${retries} failed:`, error);
                
                // Check if we're logged in despite the error
                if (error.message.includes('timeout')) {
                    logger.info('Navigation timeout occurred, verifying login status...');
                    const isLoggedIn = await this.checkLoginStatus();
                    if (isLoggedIn) {
                        logger.info('Login successful despite timeout');
                        return true;
                    }
                }
                
                if (retries < maxRetries) {
                    logger.info(`Retrying login (attempt ${retries + 1}/${maxRetries})...`);
                    await browserUtils.randomDelay(5000, 10000);
                } else {
                    throw new Error('Max login retries exceeded');
                }
            }
        }
        
        return false;
    }

    async getJobLinks() {
        try {
            // Make sure we're on the jobs page and it's loaded
            const currentUrl = await this.page.url();
            if (!currentUrl.includes(config.browser.jobsUrl)) {
                logger.info('Navigating to jobs page...');
                await this.navigateToUrl(config.browser.jobsUrl);
                await browserUtils.randomDelay(3000, 5000);
            }

            // Scroll the page to load more jobs
            await this.page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;

                        if (totalHeight >= scrollHeight || totalHeight > 3000) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
                window.scrollTo(0, 0);
            });

            await browserUtils.randomDelay(1000, 2000);

            // Extract jobs directly using page.evaluate
            const jobLinks = await this.page.evaluate(() => {
                const isVisited = (element) => {
                    if (!element) return true; // Consider null elements as visited
                    
                    // Check element and its parent hierarchy for visited state
                    let current = element;
                    while (current) {
                        // Check various visited indicators
                        if (current.classList && (
                            current.classList.contains('visited') ||
                            current.classList.contains('air3-visited') ||
                            current.classList.contains('up-visited') ||
                            current.classList.contains('job-tile-visited') ||
                            Array.from(current.classList).some(c => c.includes('visited'))
                        )) return true;
                        
                        // Check for visited data attributes
                        if (current.dataset && (
                            current.dataset.visited === 'true' ||
                            current.dataset.state === 'visited'
                        )) return true;
                        
                        current = current.parentElement;
                    }
                    return false;
                };

                const jobTiles = document.querySelectorAll('article[data-test="JobTile"]');
                return Array.from(jobTiles)
                    .filter(tile => !isVisited(tile)) // Filter out visited tiles first
                    .map(tile => {
                        const jobId = tile.getAttribute('data-ev-job-uid');
                        const titleLink = tile.querySelector('a[data-test="job-tile-title-link"]') || 
                                        tile.querySelector('.job-tile-title a');
                        
                        // Only return if both jobId exists and the link is not in a visited state
                        return (titleLink && jobId && !isVisited(titleLink)) ? {
                            href: titleLink.href,
                            jobId: jobId
                        } : null;
                    })
                    .filter(job => job !== null);
            });

            // Filter out already processed jobs
            const newJobs = jobLinks.filter(job => !this.processedJobs.has(job.jobId));
            // filter out the visted jobs

            logger.info(`Found ${newJobs.length} new job links`);
            return newJobs;

        } catch (error) {
            logger.error('Error finding job links:', error);
            return [];
        }
    }

    async isValidJobDetails(details) {
        if (!details || typeof details !== 'object') return false;
        const requiredFields = ['title', 'description', 'jobId'];
        return requiredFields.every(field => details[field]);
    }

    async processJob(jobInfo, index, totalJobs) {
        try {
            if (!jobInfo?.jobId || !jobInfo?.href) {
                logger.warn('Invalid job info received:', jobInfo);
                return { error: 'Invalid job info', status: 'failed' };
            }

            // Skip if already processed
            if (this.processedJobs.has(jobInfo.jobId)) {
                logger.info(`Skipping already processed job ${jobInfo.jobId}`);
                return { jobId: jobInfo.jobId, status: 'skipped', reason: 'already_processed' };
            }

            logger.declar(`Processing job ${index + 1}/${totalJobs}: ${jobInfo.jobId}`);
            
            // First attempt: Try modal scraping
            let modalError = null;
            try {
                // Share our page instance with the modal service
                const modalPage = this.page;
                const jobDetails = await jobModalService.scrapeJobFromModal(jobInfo, modalPage);
                
                if (jobDetails && this.isValidJobDetails(jobDetails)) {
                    this.processedJobs.add(jobInfo.jobId);
                    this.currentBatch.push(jobDetails);
                    logger.success(`Successfully scraped job ${jobInfo.jobId} using modal`);
                    return jobDetails;
                } else {
                    throw new Error('Invalid or incomplete job details from modal');
                }
            } catch (error) {
                modalError = error;
                logger.warn(`Modal scraping failed for job ${jobInfo.jobId}: ${error.message}`);

                if (error.message.includes('Access denied') || 
                    error.message.includes('Job deleted') ||
                    error.message.includes('Content blocked')) {
                    this.processedJobs.add(jobInfo.jobId);
                    return { 
                        jobId: jobInfo.jobId, 
                        status: 'skipped', 
                        reason: error.message.toLowerCase().replace(' ', '_')
                    };
                }
            }

            // Second attempt: Try direct URL scraping
            try {
                await browserUtils.randomDelay(1000, 2000);
                logger.info(`Attempting direct URL scraping for job ${jobInfo.jobId}`);
                
                const jobDetails = await jobDirectService.scrapeJobFromUrl(this.browser, jobInfo);
                
                if (jobDetails && this.isValidJobDetails(jobDetails)) {
                    this.processedJobs.add(jobInfo.jobId);
                    this.currentBatch.push(jobDetails);
                    logger.info(`Successfully scraped job ${jobInfo.jobId} using direct URL`);
                    return jobDetails;
                } else {
                    throw new Error('Invalid or incomplete job details from direct URL');
                }
            } catch (directError) {
                logger.error(`Direct URL scraping failed for job ${jobInfo.jobId}: ${directError.message}`);
                throw new Error(`Both scraping methods failed - Modal: ${modalError?.message || 'Unknown error'}; Direct: ${directError.message}`);
            }
        } catch (error) {
            const failureInfo = {
                jobId: jobInfo.jobId,
                error: error.message,
                status: 'failed',
                url: jobInfo.href,
                timestamp: new Date().toISOString()
            };
            
            logger.error(`Failed to process job ${jobInfo.jobId}:`, failureInfo);
            
            // Add to processed to avoid retrying failed jobs immediately
            this.processedJobs.add(jobInfo.jobId);
            
            return failureInfo;
        }
    }

    isValidJobDetails(details) {
        // Basic validation of job details
        return details && 
               typeof details === 'object' &&
               details.jobId &&
               details.url &&
               !details.error &&
               details.status !== 'failed';
    }

    async saveCurrentBatch() {
        if (this.currentBatch.length > 0) {
            try {
                await cache.saveJobBatch(this.currentBatch);
                this.currentBatch = [];
            } catch (error) {
                logger.error('Error saving job batch:', error);
            }
        }
    }

    async start() {
        try {
            await this.initialize();

            // Start from main page
            await this.navigateToUrl(config.browser.baseUrl);
            await browserUtils.randomDelay(2000, 3000);

            if (!await this.checkLoginStatus()) {
                if (!await this.loginWithRetry()) {
                    throw new Error('Failed to login');
                }
            }

            while (true) {
                try {
                    // Navigate to jobs page
                    await this.navigateToUrl(config.browser.jobsUrl);
                    await browserUtils.randomDelay(3000, 5000);

                    const jobLinks = await this.getJobLinks();
                    
                    if (jobLinks.length === 0) {
                        logger.info('No new jobs found, waiting before refresh...');
                        await browserUtils.randomDelay(
                            config.scraper.pageRefreshDelay.min,
                            config.scraper.pageRefreshDelay.max
                        );
                        continue;
                    }

                    // Process jobs
                    for (let i = 0; i < jobLinks.length; i++) {
                        await this.processJob(jobLinks[i], i, jobLinks.length);

                        if (this.currentBatch.length >= config.redis.jobBatchSize) {
                            await this.saveCurrentBatch();
                        }

                        await browserUtils.randomDelay(
                            config.scraper.jobProcessingDelay.min,
                            config.scraper.jobProcessingDelay.max
                        );
                    }

                    await this.saveCurrentBatch();
                    await browserUtils.randomDelay(2000, 3000);

                } catch (error) {
                    logger.error('Error during scraping cycle:', error);
                    this.currentBatch = [];
                    await browserUtils.randomDelay(
                        config.scraper.pageRefreshDelay.min,
                        config.scraper.pageRefreshDelay.max
                    );
                }
            }
        } catch (error) {
            logger.error('Fatal error during scraping:', error);
            throw error;
        }
    }
}

export default MainScraper;