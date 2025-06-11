import MainScraper from "./services/mainScraper.service.js";
import { logger } from "./utils/common.js";
import { cache } from "./utils/redis.cash.js";

class Application {
    constructor() {
        this.mainScraper = null;
        this.isRunning = false;
        this.setupShutdownHandlers();
    }

    setupShutdownHandlers() {
        // Handle graceful shutdown
        process.on('SIGTERM', () => this.shutdown('SIGTERM'));
        process.on('SIGINT', () => this.shutdown('SIGINT'));
        
        // Handle uncaught errors
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            this.shutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            this.shutdown('unhandledRejection');
        });
    }

    async initialize() {
        try {
            logger.info('Initializing application...');
            
            // // Initialize Redis connection
            // await cache.connect();
            // logger.info('Redis connection established');

            // Initialize Main Scraper
            this.mainScraper = new MainScraper();
            logger.info('Main Scraper initialized');

            this.isRunning = true;
            logger.info('Application initialized successfully');
            return true;
        } catch (error) {
            logger.error('Failed to initialize application:', error);
            throw error;
        }
    }

    async start() {
        if (!this.isRunning) {
            throw new Error('Application not initialized');
        }

        try {
            logger.info('Starting application...');
            await this.mainScraper.start();
        } catch (error) {
            logger.error('Error during application execution:', error);
            await this.shutdown('error');
        }
    }

    async shutdown(reason) {
        if (!this.isRunning) return;

        logger.info(`Shutting down application (reason: ${reason})...`);
        this.isRunning = false;

        try {
            // Cleanup resources
            if (this.mainScraper) {
                await this.mainScraper.cleanup();
            }

            // Close Redis connection
            await cache.disconnect();

            logger.info('Application shutdown completed');
            process.exit(0);
        } catch (error) {
            logger.error('Error during shutdown:', error);
            process.exit(1);
        }
    }
}

// Create health check server
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      instanceType: process.env.INSTANCE_TYPE || 'unknown',
      isActive: app?.scheduler?.isActive || false,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Start health check server on port 3000
healthServer.listen(3000, () => {
  logger.info('Health check server running on port 3000');
});

async function main() {
    const app = new Application();
    
    try {
        await app.initialize();
        await app.start();
    } catch (error) {
        logger.error('Fatal application error:', error);
        await app.shutdown('fatal_error');
    }
}

// Run the application
main().catch(error => {
    logger.error('Fatal application error:', error);
    process.exit(1);
});

