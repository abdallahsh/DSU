import { logger } from '../utils/common.js';
import cron from 'node-cron';

export class SchedulerService {
    constructor(app) {
        this.app = app;
        this.instanceType = process.env.INSTANCE_TYPE || 'even'; // 'even' or 'odd'
        this.isActive = false;
        this.scheduleCheckInterval = null;
    }

    shouldBeActive() {
        const currentHour = new Date().getHours();
        const isEvenHour = currentHour % 2 === 0;
        return (this.instanceType === 'even' && isEvenHour) || 
               (this.instanceType === 'odd' && !isEvenHour);
    }

    async start() {
        logger.info(`Starting scheduler for ${this.instanceType} instance`);
        
        // Check every minute if we should be running
        this.scheduleCheckInterval = cron.schedule('* * * * *', async () => {
            const shouldBeActive = this.shouldBeActive();
            
            if (shouldBeActive && !this.isActive) {
                logger.info(`Starting scraping for ${this.instanceType} instance`);
                this.isActive = true;
                await this.app.startScraping();
            } else if (!shouldBeActive && this.isActive) {
                logger.info(`Stopping scraping for ${this.instanceType} instance`);
                this.isActive = false;
                await this.app.stopScraping();
            }
        });

        // Initial check
        if (this.shouldBeActive()) {
            this.isActive = true;
            await this.app.startScraping();
        }
    }

    stop() {
        if (this.scheduleCheckInterval) {
            this.scheduleCheckInterval.stop();
            this.scheduleCheckInterval = null;
        }
        this.isActive = false;
    }
}

export default SchedulerService;
