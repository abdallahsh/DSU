import { browserUtils } from '../utils/common.js';
import { scrapeJobDetails } from '../utils/job.details.js';
import { logger } from '../utils/common.js';
import { BrowserService } from './browser.service.js';

export class JobDirectService extends BrowserService {
    async scrapeJobFromUrl(browser, jobInfo) {
        this.browser = browser;
        if (!this.browser) {
            throw new Error('Browser not initialized');
        }

        let newPage = null;
        try {
            // Create a new tab
            newPage = await this.browser.newPage();
            await this.setupPage(newPage);
            
            logger.info(`Opening job URL in new tab: ${jobInfo.href}`);
            await newPage.goto(jobInfo.href);

            

            
            // Validate the page and check for error states
            // await this.validateJobPage(newPage);
            
            // Add a small delay to ensure content is fully loaded
            await browserUtils.randomDelay(1000, 2000);
            
            // Use existing scrapeJobDetails function
            const jobDetails = await scrapeJobDetails(newPage, jobInfo.href, true);
            
            if (!jobDetails || Object.keys(jobDetails).length === 0) {
                throw new Error('Failed to extract job data');
            }

            // Validate required fields
            const requiredFields = ['title', 'description'];
            const missingFields = requiredFields.filter(field => !jobDetails[field]);
            if (missingFields.length > 0) {
                throw new Error(`Incomplete job details - missing: ${missingFields.join(', ')}`);
            }

            return {
                ...jobDetails,
                jobId: jobInfo.jobId,
                url: jobInfo.href,
                scrapedAt: new Date().toISOString(),
                scrapeMethod: 'direct_url'
            };

        } catch (error) {
            logger.error(`Failed to scrape job ${jobInfo.jobId}: ${error.message}`);
            throw error;
        } finally {
            // Always ensure the tab is closed
            if (newPage) {
                await newPage.close().catch(err => {
                    logger.warn(`Failed to close tab: ${err.message}`);
                });
            }
        }
    }

    async validateJobPage(page) {
        const errorStates = {
            'access-denied': '[data-test="access-denied"], .access-denied',
            'job-deleted': '[data-test="job-deleted"], .job-deleted-message',
            'content-blocked': '.blocked-content-message',
            'job-not-available': '.job-details-error, .job-not-found'
        };

        for (const [error, selector] of Object.entries(errorStates)) {
            const hasError = await page.$(selector).then(Boolean);
            if (hasError) {
                throw new Error(`Job ${error.replace('-', ' ')}`);
            }
        }

        const contentSelectors = [
            '[data-test="job-description"]',
            '.job-description',
            '.up-card-section'
        ];

        let contentFound = false;
        for (const selector of contentSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                contentFound = true;
                break;
            } catch (e) {
                continue;
            }
        }

        if (!contentFound) {
            throw new Error('Job content not found on page');
        }

        return true;
    }
}

export default new JobDirectService();