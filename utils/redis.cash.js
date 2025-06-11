import Redis from 'ioredis';
import dotenv from 'dotenv';
import { logger } from './common.js';
import { config } from './config.js';

dotenv.config();

class RedisCache {
    constructor() {
        this.client = null;
        this.connect();
    }

    connect() {
        try {
            let redisConfig = {
                keyPrefix: config.redis.keyPrefix,
                retryStrategy: this.retryStrategy,
                maxRetriesPerRequest: 3,
                enableReadyCheck: true,
                reconnectOnError: (err) => {
                    const targetError = 'READONLY';
                    if (err.message.includes(targetError)) {
                        return true;
                    }
                    return false;
                }
            };

            // Log environment variables (without sensitive data)
            logger.info('Redis connection details:');
            logger.info(`- Host: ${process.env.REDIS_HOST || 'Not set'}`);
            logger.info(`- Port: ${process.env.REDIS_PORT || 'Not set'}`);
            logger.info(`- Username: ${process.env.REDIS_USERNAME || 'Not set'}`);
            logger.info(`- REDIS_URL set: ${!!process.env.REDIS_URL}`);

            // Parse REDIS_URL if available
            if (process.env.REDIS_URL) {
                try {
                    this.client = new Redis(process.env.REDIS_URL, redisConfig);
                    logger.info('Using Redis URL for connection');
                } catch (error) {
                    logger.error('Failed to connect using REDIS_URL', error);
                    throw error;
                }
            } else {
                redisConfig = {
                    ...redisConfig,
                    host: process.env.REDIS_HOST,
                    port: process.env.REDIS_PORT,
                    username: process.env.REDIS_USERNAME,
                    password: process.env.REDIS_PASSWORD
                };

                // Log connection attempt (without sensitive data)
                logger.info(`Attempting to connect to Redis at ${redisConfig.host}:${redisConfig.port}`);

                this.client = new Redis(redisConfig);
            }

            this.setupEventListeners();
        } catch (error) {
            logger.error('Failed to initialize Redis client', error);
            throw error;
        }
    }

    setupEventListeners() {
        this.client.on('error', (error) => {
            logger.error('Redis connection error', error);
            setTimeout(() => {
                logger.info('Attempting to reconnect to Redis...');
                this.connect();
            }, 5000);
        });

        this.client.on('connect', () => {
            logger.info('Redis connected successfully');
        });

        this.client.on('ready', () => {
            logger.info('Redis client ready');
        });

        this.client.on('reconnecting', () => {
            logger.info('Redis client reconnecting...');
        });

        this.client.on('end', () => {
            logger.info('Redis connection ended');
        });
    }

    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }

    async saveJobData(jobId, jobData) {
        try {
            if (!this.client) {
                throw new Error('Redis client not initialized');
            }

            const key = `job:${jobId}`;
            await this.client.set(key, JSON.stringify(jobData));
            logger.info(`Job data saved for ID: ${jobId}`);
            return true;
        } catch (error) {
            logger.error('Error saving job data', error);
            return false;
        }
    }

    async getJobData(jobId) {
        try {
            if (!this.client) {
                throw new Error('Redis client not initialized');
            }

            const key = `job:${jobId}`;
            const data = await this.client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error('Error getting job data', error);
            return null;
        }
    }

    async isJobProcessed(jobId) {
        try {
            if (!this.client) {
                throw new Error('Redis client not initialized');
            }

            const key = `job:${jobId}`;
            return await this.client.exists(key) === 1;
        } catch (error) {
            logger.error('Error checking job status', error);
            return false;
        }
    }

    // Constants for Redis keys and TTL
    SCRAPE_PREFIX = 'uid:';
    CACHE_TTL = 600; // 10 minutes in seconds

    async saveJobBatch(jobs) {
        try {
            if (!this.client) {
                throw new Error('Redis client not initialized');
            }

            const pipeline = this.client.pipeline();
            let successCount = 0;
            let errorCount = 0;

            for (const job of jobs) {
                try {
                    // Ensure we have a job ID
                    if (!job.jobId) {
                        logger.warn('Job missing ID, skipping:', job);
                        errorCount++;
                        continue;
                    }

                    // Create the Redis key with proper prefix
                    const redisKey = `${this.SCRAPE_PREFIX}${job.jobId}`;

                    // Check if this job already exists
                    const exists = await this.client.exists(redisKey);
                    if (exists) {
                        logger.debug(`Job ${job.jobId} already exists in Redis, skipping`);
                        continue;
                    }

                    // Add to pipeline with TTL
                    pipeline.set(
                        redisKey,
                        JSON.stringify({
                            ...job,
                            _meta: {
                                savedAt: new Date().toISOString(),
                                expiresIn: this.CACHE_TTL
                            }
                        }),
                        'EX',
                        this.CACHE_TTL
                    );
                    successCount++;

                    // Log progress every 10 jobs
                    if (successCount % 10 === 0 || successCount === 1) {
                        logger.info(`Progress: ${successCount}/${jobs.length} jobs queued for saving`);
                    }
                } catch (jobError) {
                    errorCount++;
                    logger.error(`Error processing job for Redis save: ${jobError.message}`);
                }
            }

            // Execute pipeline
            const results = await pipeline.exec();
            
            // Check pipeline results
            const failedOps = results.filter(([err]) => err).length;
            if (failedOps > 0) {
                logger.warn(`${failedOps} Redis operations failed during batch save`);
            }

            logger.info(`Batch save complete: ${successCount} saved, ${errorCount} errors`);
            return successCount > 0;
        } catch (error) {
            logger.error('Error saving job batch:', error);
            return false;
        }
    }

    async clear() {
        try {
            if (!this.client) {
                throw new Error('Redis client not initialized');
            }

            const keys = await this.client.keys(`${config.redis.keyPrefix}*`);
            if (keys.length > 0) {
                await this.client.del(keys);
            }
            return true;
        } catch (error) {
            logger.error('Cache clear error', error);
            return false;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.quit();
            this.client = null;
        }
    }

    async getScrapedJob(jobId) {
        try {
            if (!this.client) {
                throw new Error('Redis client not initialized');
            }

            const key = `${this.SCRAPE_PREFIX}${jobId}`;
            const data = await this.client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error(`Error getting scraped job ${jobId}:`, error);
            return null;
        }
    }

    async isJobScraped(jobId) {
        try {
            if (!this.client) {
                throw new Error('Redis client not initialized');
            }

            const key = `${this.SCRAPE_PREFIX}${jobId}`;
            return await this.client.exists(key) === 1;
        } catch (error) {
            logger.error(`Error checking if job ${jobId} is scraped:`, error);
            return false;
        }
    }

    async getScrapedJobsCount() {
        try {
            if (!this.client) {
                throw new Error('Redis client not initialized');
            }

            const keys = await this.client.keys(`${this.SCRAPE_PREFIX}*`);
            return keys.length;
        } catch (error) {
            logger.error('Error getting scraped jobs count:', error);
            return 0;
        }
    }
}

export const cache = new RedisCache();
