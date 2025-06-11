import { BrowserService } from './browser.service.js';
// import { cache } from '../utils/redis.cache.js';
import { delay, logger } from '../utils/common.js';
import { config } from '../utils/config.js';

export class UrlScraperService {
  constructor() {
    this.browserService = new BrowserService();
    this.page = this.browserService;

    this.isRunning = false;
    this.SCRAPE_PREFIX = 'job_url:';
    this.CACHE_TTL = config.scraper.UrlRedisTtl;
    this.totalScrapedSinceStart = 0; // Track total unique URLs scraped since program start
  }

  async scrapeUpworkJobUrls(page) {
    if (this.isRunning) {
      logger.info('Scraper is already running. Skipping this cycle.');
      return;
    }

    this.isRunning = true;
    let allUrls = [];
    
    try {
      // Only try 2 times (original attempt + 1 retry)
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          logger.info(`Scraping attempt ${attempt}/2...`);
          await this.browserService.initialize();
          
          // Only scrape page 1
          await this.browserService.navigateToPage(config.browser.baseUrl);
          
          // Use our own delay function instead of browser's waitForTimeout
          await delay(2000); // Give the page more time to load
          await this.browserService.simulateHumanBehavior();
          
          const urls = await this.browserService.extractUrls();
          logger.info(`Found ${urls.length} job URLs on page 1`);
          
          if (urls.length > 0) {
            allUrls.push(...urls);
            logger.info(`Scraping completed successfully on attempt ${attempt}`);
            break; // Success, exit retry loop
          } else {
            logger.info(`No URLs found on attempt ${attempt}`);
            if (attempt < 2) {
              logger.info(`Retrying in 5s...`);
              await delay(5000); // 5 second delay between retries
            }
          }
        } catch (err) {
          logger.error(`Scrape attempt ${attempt} failed`, err);
          
          if (attempt < 2) {
            logger.info(`Retrying in 5s...`);
            await delay(5000); // 5 second delay between retries
          } else {
            logger.error(`Scraping failed after 2 attempts`);
          }
        } finally {
          await this.browserService.cleanup();
        }
      }

      // Remove duplicates using Set
      const uniqueUrls = [...new Set(allUrls)];
      logger.info(`Total unique URLs scraped: ${uniqueUrls.length}`);
      
      if (uniqueUrls.length === 0) {
        logger.info('No URLs scraped.');
        return;
      }

      // Update the total scraped count
      this.totalScrapedSinceStart += uniqueUrls.length;
      
    //   await this.saveUrlsToRedis(uniqueUrls);
    } finally {
      this.isRunning = false;
    }
  }

//   async saveUrlsToRedis(urls) {
//     try {
//       logger.info('Saving URLs to Redis...');
      
//       let newUrlsCount = 0;
//       let errorCount = 0;
      
//       // Get the current timestamp for ordering
//       const timestamp = Date.now();
      
//       // Save each URL individually with a prefix
//       for (let i = 0; i < urls.length; i++) {
//         try {
//           const url = urls[i];
//           // Extract job ID from URL
//           const jobId = this.extractJobId(url);
          
//           // Create a unique identifier - either use the job ID or a timestamp-based index
//           const uniqueId = jobId || `job_${timestamp}_${i}`;
          
//           // Create the Redis key with the prefix
//           const redisKey = `${this.SCRAPE_PREFIX}${uniqueId}`;
          
//           // Check if this job ID already exists
//           const existingUrl = await cache.get(redisKey);
          
//           if (!existingUrl) {
//             // Save the URL with the job ID as part of the key
//             const success = await cache.set(redisKey, url, this.CACHE_TTL);
            
//             if (success) {
//               newUrlsCount++;
//               // Only log every 10th URL to reduce verbosity
//               if (newUrlsCount % 10 === 0 || newUrlsCount === 1) {
//                 logger.info(`Progress: ${newUrlsCount}/${urls.length} URLs saved to Redis`);
//               }
//             } else {
//               errorCount++;
//               logger.error(`Failed to save URL to Redis: ${uniqueId}`);
//             }
//           }
//         } catch (urlError) {
//           errorCount++;
//           logger.error(`Error processing URL`, urlError);
//         }
//       }
      
//       // Get total count of URLs in Redis
//       try {
//         const keys = await cache.keys(`${this.SCRAPE_PREFIX}*`);
//         const totalInRedis = keys.length;
        
//         // Log a comprehensive summary
//         logger.summary('SCRAPING SUMMARY', {
//           'URLs found on page': urls.length,
//           'New URLs saved': newUrlsCount,
//           'Errors encountered': errorCount,
//           'Total URLs in Redis': totalInRedis,
//           'Total unique URLs scraped since start': this.totalScrapedSinceStart
//         });
//       } catch (keysError) {
//         logger.error('Error getting Redis keys count', keysError);
//       }
//     } catch (err) {
//       logger.error('Redis error', err);
//     }
//   }
  
  // Helper method to extract job ID from URL
  extractJobId(url) {
    try {
      // Try different patterns to extract job ID
      // Pattern 1: /jobs/~[jobId]
      let match = url.match(/\/jobs\/~([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return match[1];
      }
      
      // Pattern 2: /jobs/[jobTitle]_~[jobId]
      match = url.match(/\/jobs\/[^_]+_~([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return match[1];
      }
      
      // If no match found, return null
      return null;
    } catch (error) {
      logger.error('Error extracting job ID', error);
      return null;
    }
  }

  async start(page) {
    logger.info('Upwork job URL scraper started.');
    await this.scrapeUpworkJobUrls(page);
    
    // Run every 10 minutes
    const interval = setInterval(async () => {
      try {
        await this.scrapeUpworkJobUrls(page);
      } catch (err) {
        logger.error('Error in scraping cycle', err);
      }
    }, 10 * 60 * 1000);
    
    // Store the interval ID for cleanup
    this.intervalId = interval;
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    if (this.browserService) {
      await this.browserService.cleanup();
    }
    
    logger.info('Scraper stopped.');
  }
} 