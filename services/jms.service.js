import { browserUtils } from '../utils/common.js';
import { scrapeJobDetailsFromModal } from '../utils/job.details.js';
import { logger } from '../utils/common.js';
import { config } from '../utils/config.js';
import { BrowserService } from './browser.service.js';

export class JobModalService extends BrowserService {    
    async ensureCleanModalState(customPage = null) {
        try {
            const page = customPage || this.page;
            if (!page) {
                throw new Error('No page instance available for modal cleanup');
            }

            // First check if there's actually a modal open
            const modalOpen = await page.$('div[role="dialog"]').then(Boolean);
            if (!modalOpen) {
                return true;
            }

            // Try to close any open modals
            const closeSelectors = [
                '[data-test="close-modal"]',
                'button[aria-label="Close"]',
                '.modal-close-button',
                config.selectors.jobs.closeModal
            ];

            for (const selector of closeSelectors) {
                try {
                    const closeButton = await page.$(selector);
                    if (closeButton) {
                        const isVisible = await closeButton.isVisible();
                        if (isVisible) {
                            await closeButton.click();
                            await browserUtils.randomDelay(500, 1000);
                            
                            // Verify modal is closed
                            const stillOpen = await page.$('div[role="dialog"]').then(Boolean);
                            if (!stillOpen) {
                                return true;
                            }
                        }
                    }
                } catch (err) {
                    continue;
                }
            }

            // Press Escape as a fallback
            await page.keyboard.press('Escape');
            await browserUtils.randomDelay(500, 1000);

            // Final check
            const modalStillOpen = await page.$('div[role="dialog"]').then(Boolean);
            return !modalStillOpen;

        } catch (error) {
            logger.warn('Error while cleaning modal state:', error.message);
            return false;
        }
    }
    async scrapeJobFromModal(jobInfo, sharedPage = null) {
        // Use the shared page if provided, otherwise use our own
        const page = sharedPage || this.page;
        if (!page) {
            throw new Error('No page instance available for modal scraping');
        }
        
        const maxRetries = 2;
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.declar(`Modal scraping attempt ${attempt}/${maxRetries} for job ${jobInfo.jobId}`);
                
                // Ensure clean state before attempting to open modal
                // await this.ensureCleanModalState();
                await browserUtils.randomDelay(500, 1000);
                
                // Multiple selector strategies for job cards
                const cardSelectors = [
                    `article[data-ev-job-uid="${jobInfo.jobId}"]`,
                    `div[data-ev-job-uid="${jobInfo.jobId}"]`,
                    `[data-job-id="${jobInfo.jobId}"]`,
                    `[data-test="job-tile"][data-job-uid="${jobInfo.jobId}"]`
                ];
                
                // Try each selector
                let clicked = false;
                for (const selector of cardSelectors) {
                    const element = await page.$(selector);
                    if (element) {
                        // Ensure element is visible and in viewport
                        const isVisible = await page.evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            return rect.top >= 0 && rect.left >= 0 &&
                                   rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
                        }, element);
                        
                        if (!isVisible) {
                            await page.evaluate(el => {
                                el.scrollIntoView({ behavior: 'instant', block: 'center' });
                            }, element);
                            await browserUtils.randomDelay(500, 1000);
                        }
                        
                        clicked = await element.click().then(() => true).catch(() => false);
                        if (clicked) break;
                    }
                }
                
                if (!clicked) {
                    throw new Error('Failed to click job card - element not found or not clickable');
                }

                // Wait for modal to load with multiple indicator selectors
                const modalLoadedSelectors = [
                    '[data-test="SaveJob"]',
                    '[data-test="job-details-modal"]',
                    'div[role="dialog"]'
                ];

                await browserUtils.randomDelay(1000, 2000);                
                let modalLoaded = false;
                for (const selector of modalLoadedSelectors) {
                    try {
                        await page.waitForSelector(selector, {
                            visible: true,
                            timeout: 5000
                        });
                        modalLoaded = true;
                        break;
                    } catch (err) {
                        continue;
                    }
                }

                if (!modalLoaded) {
                    throw new Error('Modal failed to open properly - no modal indicators found');
                }
                
                // Wait a moment for any error messages to appear
                await browserUtils.randomDelay(1000, 2000);

                // Check for various error states
                const errorStates = {
                    'Access denied': 'h1.mt-5.mb-4.text-light-on-muted, [data-test="access-denied"]',
                    'Job deleted': '[data-test="job-deleted"], .job-deleted-message',
                    'Content blocked': '.blocked-content-message, .content-blocked',
                    'Job not available': '.job-details-error, .job-not-found'
                };

                for (const [error, selector] of Object.entries(errorStates)) {
                    const hasError = await page.$eval(selector,
                        (el, errorText) => el?.textContent?.toLowerCase().includes(errorText.toLowerCase()),
                        error
                    ).catch(() => false);

                    if (hasError) {
                        throw new Error(error);
                    }
                }   
                 // Extract job details using the shared page
                const jobDetails = await scrapeJobDetailsFromModal(page);
                
                if (!jobDetails) {
                    throw new Error('Failed to extract modal data - null response');
                }

                if (Object.keys(jobDetails).length === 0) {
                    throw new Error('Failed to extract modal data - empty response');
                }

                // Verify essential fields
                const requiredFields = ['title', 'description'];
                const missingFields = requiredFields.filter(field => !jobDetails[field]);
                if (missingFields.length > 0) {
                    throw new Error(`Incomplete job details - missing: ${missingFields.join(', ')}`);
                }

                // Close modal - try multiple close strategies
                const closeSelectors = [
                    config.selectors.jobs.closeModal,
                    '[data-test="close-modal"]',
                    'button[aria-label="Close"]',
                    '.modal-close-button'
                ];

                let closed = false;
                for (const selector of closeSelectors) {
                    try {
                        const closeButton = await page.$(selector);
                        if (closeButton) {
                            const isVisible = await closeButton.isVisible();
                            if (isVisible) {
                                await closeButton.click();
                                closed = true;
                                break;
                            }
                        }
                    } catch (err) {
                        continue;
                    }
                }   
                
                if (!closed) {
                    // Try pressing Escape key as fallback
                    await page.keyboard.press('Escape');
                    logger.warn('Used Escape key to close modal after button clicks failed');
                }

                // Verify modal is actually closed
                await browserUtils.randomDelay(1000, 2000);
                const modalStillOpen = await page.$('div[role="dialog"]').then(Boolean);
                if (modalStillOpen) {
                    logger.warn('Modal appears to still be open after close attempts');
                    // One final attempt with Escape key
                    await page.keyboard.press('Escape');
                }

                return {
                    ...jobDetails,
                    jobId: jobInfo.jobId,
                    url: jobInfo.href,
                    scrapedAt: new Date().toISOString(),
                    scrapeMethod: 'modal',
                    scrapedWithRetry: attempt > 1
                };

            } catch (error) {
                lastError = error;
                logger.warn(`Modal scraping attempt ${attempt}/${maxRetries} failed for job ${jobInfo.jobId}: ${error.message}`);
                
                // Don't retry certain errors
                if (error.message.includes('Access denied') ||
                    error.message.includes('Job deleted') ||
                    error.message.includes('Content blocked')) {
                    throw error;
                }
                
                if (attempt < maxRetries) {
                    // Cleanup before retry
                    try {
                        // First try to close any stuck modals
                        await page.keyboard.press('Escape');
                        await browserUtils.randomDelay(1000, 2000);
                        
                        // Check if modal is still stuck
                        const modalStuck = await page.$('div[role="dialog"]').then(Boolean);
                        if (modalStuck) {
                            await page.keyboard.press('Escape');
                            await browserUtils.randomDelay(1000, 2000);
                        }
                        
                        // // Refresh page if needed
                        // if (error.message.includes('Modal failed to open') || 
                        //     error.message.includes('Failed to click') ||
                        //     error.message.includes('timeout')) {
                        //     await page.reload({ 
                        //         waitUntil: ['domcontentloaded', 'networkidle0'],
                        //         timeout: 30000 
                        //     });
                        //     await browserUtils.randomDelay(2000, 3000);
                        // }
                    } catch (cleanupError) {
                        logger.warn('Error during cleanup before retry:', cleanupError.message);
                    }
                    continue;
                }
            }
        }
        
        // If we get here, all retries failed
        throw new Error(`Modal scraping failed after ${maxRetries} attempts: ${lastError?.message}`);
    }

    async ensureModalClosed() {
        try {
            const closeSelectors = [
                config.selectors.jobs.closeModal,
                '[data-test="close-modal"]',
                'button[aria-label="Close"]',
                '.modal-close-button'
            ];

            for (const selector of closeSelectors) {
                const closeButton = await this.page.$(selector);
                if (closeButton) {
                    await closeButton.click();
                    await browserUtils.randomDelay(500, 1000);
                    return true;
                }
            }

            // Fallback to Escape key
            await this.page.keyboard.press('Escape');
            await browserUtils.randomDelay(500, 1000);
            return true;
        } catch (error) {
            logger.warn('Error ensuring modal is closed:', error);
            return false;
        }
    }
}

export default new JobModalService();