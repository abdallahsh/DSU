module.exports = {
  apps: [
    {
      name: 'upwork-scraper-even',
      script: 'app.js',
      env: {
        NODE_ENV: 'production',
        INSTANCE_TYPE: 'even',
        REDIS_HOST: 'your-redis-host',
        REDIS_PORT: '6379',
        REDIS_USERNAME: 'your-redis-username',
        REDIS_PASSWORD: 'your-redis-password',
        UPWORK_EMAIL: 'your-upwork-email',
        UPWORK_PASSWORD: 'your-upwork-password'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/even/error.log',
      out_file: 'logs/even/out.log'
    },
    {
      name: 'upwork-scraper-odd',
      script: 'app.js',
      env: {
        NODE_ENV: 'production',
        INSTANCE_TYPE: 'odd',
        REDIS_HOST: 'your-redis-host',
        REDIS_PORT: '6379',
        REDIS_USERNAME: 'your-redis-username',
        REDIS_PASSWORD: 'your-redis-password',
        UPWORK_EMAIL: 'your-upwork-email',
        UPWORK_PASSWORD: 'your-upwork-password'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/odd/error.log',
      out_file: 'logs/odd/out.log'
    }
  ]
};
