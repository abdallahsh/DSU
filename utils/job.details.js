import { logger } from './common.js';

// Description: This module contains functions to scrape job details from a given URL or modal using Puppeteer.
export const scrapeJobDetails = async (page, url, skipNavigation = false) => {
  try {
    if (!skipNavigation) {
      await page.goto(url, { waitUntil: ["domcontentloaded", "networkidle0"], timeout: 30000 });
    }

    // Wait for any of these selectors to appear
    const selectors = ['.job-details-content', '[data-test="job-description"]'];
    
    let contentFound = false;
    
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        contentFound = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!contentFound) {
      throw new Error('Job content not found');
    }

    const jobData = await page.evaluate((jobUrl) => {
      const getData = (selector, attr = 'textContent') => {
        const el = document.querySelector(selector);
        return el ? el[attr].trim() : 'N/A';
      };

      const getScreeningQuestions = () => {
        const questionsSection = document.querySelector('[data-test="Questions"] ol');
        if (!questionsSection) return null;
        return Array.from(questionsSection.querySelectorAll('li'))
          .map(li => li.textContent.trim())
          .filter(q => q);
      };

      const getRequiredConnects = () => {
        const desktopConnects = document.querySelector('[data-test="ConnectsDesktop"] span:nth-child(2)')?.textContent?.trim();
        if (desktopConnects) return desktopConnects;

        const auctionEl = document.querySelector('[data-test="ConnectsAuction"] div strong');
        if (auctionEl) {
          const match = auctionEl.textContent.match(/(\d+)/);
          return match ? match[1] : 'N/A';
        }

        const mobileEl = document.querySelector('[data-test="ConnectsMobile"] .flex-sm-1');
        if (mobileEl) {
          const match = mobileEl.textContent.match(/(\d+)/);
          return match ? match[1] : 'N/A';
        }

        return 'N/A';
      };

      const getPaymentDetails = () => {
        const isHourly = document.querySelector('[data-cy="clock-hourly"]');
        const isFixed = document.querySelector('[data-cy="fixed-price"]');

        if (isHourly) {
          const prices = Array.from(document.querySelectorAll('[data-test="BudgetAmount"] strong'))
            .map(el => el.textContent.trim());
          return {
            workType: 'Hourly',
            duration: getData('[data-cy="duration1"] + strong, [data-cy="duration2"] + strong'),
            price: prices.length === 2 ? { min: prices[0], max: prices[1] } : { min: 'N/A', max: 'N/A' }
          };
        }

        if (isFixed) {
          return {
            workType: 'Fixed-price',
            price: getData('[data-cy="fixed-price"] + div [data-test="BudgetAmount"] strong'),
            duration: 'N/A'
          };
        }

        return { workType: 'N/A', price: 'N/A', duration: 'N/A' };
      };

      const getClientStats = () => {
        const spentEl = document.querySelector('[data-qa="client-spend"] span span');
        const hiresEl = document.querySelector('[data-qa="client-hires"]');
        const jobStatsEl = document.querySelector('[data-qa="client-job-posting-stats"] strong');
        const jobDetailsEl = document.querySelector('[data-qa="client-job-posting-stats"] div');
        
        return {
          totalSpent: spentEl ? spentEl.textContent.trim() : 'N/A',
          hires: hiresEl ? hiresEl.textContent.trim() : 'N/A',
          postedJobs: jobStatsEl ? jobStatsEl.textContent.trim() : 'N/A',
          jobDetails: jobDetailsEl ? jobDetailsEl.textContent.trim() : 'N/A'
        };
      };

      const getClientInfo = () => ({
        paymentVerified: document.querySelector('.payment-verified') !== null,
        rating: getData('[data-ev-sublocation="!rating"] .air3-rating-value-text'),
        reviews: getData('.rating .nowrap'),
        location: {
          country: getData('[data-qa="client-location"] strong'),
          city: getData('[data-qa="client-location"] .nowrap:first-child'),
          timezone: getData('[data-qa="client-location"] .nowrap:last-child')
        },
        jobStats: getClientStats(),
        companyInfo: {
          industry: getData('[data-qa="client-company-profile-industry"]'),
          size: getData('[data-qa="client-company-profile-size"]'),
          memberSince: getData('[data-qa="client-contract-date"] small')
        }
      });

      const getClientHistory = () => {
        const historySection = document.querySelector('[data-cy="jobs"]');
        if (!historySection) return [];

        return Array.from(historySection.querySelectorAll('[data-cy="job"]'))
          .map(item => {
            // Get job title and URL
            const jobLink = item.querySelector('.js-job-link');
            let jobTitle = null;
            let jobUrl = null;

            // If jobLink exists, get data from it
            if (jobLink) {
              jobTitle = jobLink.textContent?.trim();
              jobUrl = jobLink.href;
            } else {
              // Otherwise try to get title from span
              const titleSpan = item.querySelector('[data-cy="job-title"]');
              jobTitle = titleSpan?.textContent?.trim();
            }

            // If we still don't have a title, this entry is invalid
            if (!jobTitle) return null;

            // Rest of the data extraction
            const freelancerLink = item.querySelector('[data-test="FreelancerLink"] a');
            const freelancerName = freelancerLink?.textContent?.trim() || 
                                  item.querySelector('[data-test="FreelancerLink"]')?.textContent?.trim() || 
                                  'N/A';
            const freelancerUrl = freelancerLink?.href || null;

            const clientRating = item.querySelector('[data-ev-sublocation="!rating"] .air3-rating-value-text')?.textContent?.trim();
            const freelancerRating = item.querySelector('[data-test="FeedbackToFreelancer"] .air3-rating-value-text')?.textContent?.trim();

            const feedbackSpan = item.querySelector('.air3-truncation span[id^="air3-truncation"]');
            const clientFeedback = feedbackSpan?.textContent?.trim();
            
            const freelancerFeedbackSpan = item.querySelector('[data-test="FeedbackToFreelancer"] span[id^="air3-truncation"]');
            const freelancerFeedback = freelancerFeedbackSpan?.textContent?.trim();

            const dates = item.querySelector('[data-cy="date"] .text-body-sm')?.textContent?.trim()?.replace(/\s+/g, ' ');
            const payment = item.querySelector('[data-cy="stats"]')?.textContent?.trim()?.replace(/\s+/g, ' ');

            const noFeedbackGiven = item.textContent.includes('No feedback given');

            return {
              jobTitle,
              jobUrl,
              freelancer: {
                name: freelancerName,
                url: freelancerUrl,
                rating: freelancerRating || 'N/A',
                feedback: freelancerFeedback || 'No feedback given'
              },
              client: {
                rating: clientRating || 'N/A',
                feedback: clientFeedback || 'No feedback given'
              },
              dates,
              payment,
              hasFeedback: !noFeedbackGiven
            };
          })
          .filter(item => item !== null); // Remove any null entries
      };

      return {
        title: getData('.air3-card-sections h4 span.flex-1'),
        featured: document.querySelector('#featured-job') !== null ? 1 : 0,
        description: getData('.break .text-body-sm'),
        screeningQuestions: getScreeningQuestions(),
        postedDate: getData('[data-test="PostedOn"] span'),
        location: getData('[data-test="LocationLabel"] span.text-light-on-muted'),
        projectType: getData('[data-test="Segmentations"] span'),
        requiredConnects: getRequiredConnects(),
        experienceLevel: getData('[data-test="Features"] li [data-cy="expertise"] + strong'),
        url: jobUrl,
        paymentDetails: getPaymentDetails(),
        skills: Array.from(document.querySelectorAll('.skills-list .air3-badge'))
          .map(skill => skill.textContent.trim()),
        client: getClientInfo(),
        clientHistory: getClientHistory()
      };
    }, url);


    return jobData;
  } catch (error) {
    console.error(`Error scraping job details for ${url}:`, error.message);
    return null;
  }
};

// Add modal scraping capability
export const scrapeJobDetailsFromModal = async (page) => {
  try {
    await page.waitForSelector('.job-details-content', { 
      timeout: 10000,
      visible: true 
    });

    // Use the same evaluation logic as the main scraper
    const jobData = await page.evaluate(() => {
      // Reuse the same helper functions
      const getData = (selector, attr = 'textContent') => {
        const el = document.querySelector(selector);
        return el ? el[attr].trim() : 'N/A';
      };

      // Reuse all the helper functions from the main scraper
      const getScreeningQuestions = () => {
        const questionsSection = document.querySelector('[data-test="Questions"] ol');
        if (!questionsSection) return null;
        return Array.from(questionsSection.querySelectorAll('li'))
          .map(li => li.textContent.trim())
          .filter(q => q);
      };

      const getRequiredConnects = () => {
        const desktopConnects = document.querySelector('[data-test="ConnectsDesktop"] span:nth-child(2)')?.textContent?.trim();
        if (desktopConnects) return desktopConnects;

        const auctionEl = document.querySelector('[data-test="ConnectsAuction"] div strong');
        if (auctionEl) {
          const match = auctionEl.textContent.match(/(\d+)/);
          return match ? match[1] : 'N/A';
        }

        const mobileEl = document.querySelector('[data-test="ConnectsMobile"] .flex-sm-1');
        if (mobileEl) {
          const match = mobileEl.textContent.match(/(\d+)/);
          return match ? match[1] : 'N/A';
        }

        return 'N/A';
      };

      const getPaymentDetails = () => {
        const isHourly = document.querySelector('[data-cy="clock-hourly"]');
        const isFixed = document.querySelector('[data-cy="fixed-price"]');

        if (isHourly) {
          const prices = Array.from(document.querySelectorAll('[data-test="BudgetAmount"] strong'))
            .map(el => el.textContent.trim());
          return {
            workType: 'Hourly',
            duration: getData('[data-cy="duration1"] + strong, [data-cy="duration2"] + strong'),
            price: prices.length === 2 ? { min: prices[0], max: prices[1] } : { min: 'N/A', max: 'N/A' }
          };
        }

        if (isFixed) {
          return {
            workType: 'Fixed-price',
            price: getData('[data-cy="fixed-price"] + div [data-test="BudgetAmount"] strong'),
            duration: 'N/A'
          };
        }

        return { workType: 'N/A', price: 'N/A', duration: 'N/A' };
      };

      const getClientStats = () => {
        const spentEl = document.querySelector('[data-qa="client-spend"] span span');
        const hiresEl = document.querySelector('[data-qa="client-hires"]');
        const jobStatsEl = document.querySelector('[data-qa="client-job-posting-stats"] strong');
        const jobDetailsEl = document.querySelector('[data-qa="client-job-posting-stats"] div');
        
        return {
          totalSpent: spentEl ? spentEl.textContent.trim() : 'N/A',
          hires: hiresEl ? hiresEl.textContent.trim() : 'N/A',
          postedJobs: jobStatsEl ? jobStatsEl.textContent.trim() : 'N/A',
          jobDetails: jobDetailsEl ? jobDetailsEl.textContent.trim() : 'N/A'
        };
      };

      const getClientInfo = () => ({
        paymentVerified: document.querySelector('.payment-verified') !== null,
        rating: getData('[data-ev-sublocation="!rating"] .air3-rating-value-text'),
        reviews: getData('.rating .nowrap'),
        location: {
          country: getData('[data-qa="client-location"] strong'),
          city: getData('[data-qa="client-location"] .nowrap:first-child'),
          timezone: getData('[data-qa="client-location"] .nowrap:last-child')
        },
        jobStats: getClientStats(),
        companyInfo: {
          industry: getData('[data-qa="client-company-profile-industry"]'),
          size: getData('[data-qa="client-company-profile-size"]'),
          memberSince: getData('[data-qa="client-contract-date"] small')
        }
      });

      const getClientHistory = () => {
        const historySection = document.querySelector('[data-cy="jobs"]');
        if (!historySection) return [];

        return Array.from(historySection.querySelectorAll('[data-cy="job"]'))
          .map(item => {
            // Get job title and URL
            const jobLink = item.querySelector('.js-job-link');
            let jobTitle = null;
            let jobUrl = null;

            // If jobLink exists, get data from it
            if (jobLink) {
              jobTitle = jobLink.textContent?.trim();
              jobUrl = jobLink.href;
            } else {
              // Otherwise try to get title from span
              const titleSpan = item.querySelector('[data-cy="job-title"]');
              jobTitle = titleSpan?.textContent?.trim();
            }

            // If we still don't have a title, this entry is invalid
            if (!jobTitle) return null;

            // Rest of the data extraction
            const freelancerLink = item.querySelector('[data-test="FreelancerLink"] a');
            const freelancerName = freelancerLink?.textContent?.trim() || 
                                  item.querySelector('[data-test="FreelancerLink"]')?.textContent?.trim() || 
                                  'N/A';
            const freelancerUrl = freelancerLink?.href || null;

            const clientRating = item.querySelector('[data-ev-sublocation="!rating"] .air3-rating-value-text')?.textContent?.trim();
            const freelancerRating = item.querySelector('[data-test="FeedbackToFreelancer"] .air3-rating-value-text')?.textContent?.trim();

            const feedbackSpan = item.querySelector('.air3-truncation span[id^="air3-truncation"]');
            const clientFeedback = feedbackSpan?.textContent?.trim();
            
            const freelancerFeedbackSpan = item.querySelector('[data-test="FeedbackToFreelancer"] span[id^="air3-truncation"]');
            const freelancerFeedback = freelancerFeedbackSpan?.textContent?.trim();

            const dates = item.querySelector('[data-cy="date"] .text-body-sm')?.textContent?.trim()?.replace(/\s+/g, ' ');
            const payment = item.querySelector('[data-cy="stats"]')?.textContent?.trim()?.replace(/\s+/g, ' ');

            const noFeedbackGiven = item.textContent.includes('No feedback given');

            return {
              jobTitle,
              jobUrl,
              freelancer: {
                name: freelancerName,
                url: freelancerUrl,
                rating: freelancerRating || 'N/A',
                feedback: freelancerFeedback || 'No feedback given'
              },
              client: {
                rating: clientRating || 'N/A',
                feedback: clientFeedback || 'No feedback given'
              },
              dates,
              payment,
              hasFeedback: !noFeedbackGiven
            };
          })
          .filter(item => item !== null); // Remove any null entries
      };

      // Return the same structure as the main scraper
      return {
        title: getData('.air3-card-sections h4 span.flex-1'),
        featured: document.querySelector('#featured-job') !== null ? 1 : 0,
        description: getData('.break .text-body-sm'),
        screeningQuestions: getScreeningQuestions(),
        postedDate: getData('[data-test="PostedOn"] span'),
        location: getData('[data-test="LocationLabel"] span.text-light-on-muted'),
        projectType: getData('[data-test="Segmentations"] span'),
        requiredConnects: getRequiredConnects(),
        experienceLevel: getData('[data-test="Features"] li [data-cy="expertise"] + strong'),
        url: window.location.href,
        paymentDetails: getPaymentDetails(),
        skills: Array.from(document.querySelectorAll('.skills-list .air3-badge'))
          .map(skill => skill.textContent.trim()),
        client: getClientInfo(),
        clientHistory: getClientHistory()
      };
    });

    return jobData;
  } catch (error) {
    if (error.name === 'TimeoutError') {
      console.warn('Modal content load timeout - skipping data extraction');
      return null;
    }
    throw error;
  }
};

export default {
  scrapeJobDetails,
  scrapeJobDetailsFromModal
};
