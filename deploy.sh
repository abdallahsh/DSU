#!/bin/bash

# Install Chrome
sudo yum update -y
sudo yum install -y google-chrome-stable

# Install Node.js 18.x
curl -sL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Create app directory structure
mkdir -p /home/ec2-user/app
mkdir -p /home/ec2-user/app/user_data
mkdir -p /home/ec2-user/app/logs/even
mkdir -p /home/ec2-user/app/logs/odd

# Set permissions
sudo chown -R ec2-user:ec2-user /home/ec2-user/app

# Install PM2 globally
sudo npm install -g pm2

# Install dependencies
cd /home/ec2-user/app
npm install --production

# Create production ecosystem file for PM2
cat > ecosystem.config.js << EOL
module.exports = {
  apps: [
    {
      name: 'upwork-scraper-even',
      script: 'app.js',
      env: {
        NODE_ENV: 'production',
        INSTANCE_TYPE: 'even',
        REDIS_HOST: '${REDIS_HOST}',
        REDIS_PORT: '${REDIS_PORT}',
        REDIS_USERNAME: '${REDIS_USERNAME}',
        REDIS_PASSWORD: '${REDIS_PASSWORD}',
        UPWORK_EMAIL: '${UPWORK_EMAIL}',
        UPWORK_PASSWORD: '${UPWORK_PASSWORD}'
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
        REDIS_HOST: '${REDIS_HOST}',
        REDIS_PORT: '${REDIS_PORT}',
        REDIS_USERNAME: '${REDIS_USERNAME}',
        REDIS_PASSWORD: '${REDIS_PASSWORD}',
        UPWORK_EMAIL: '${UPWORK_EMAIL}',
        UPWORK_PASSWORD: '${UPWORK_PASSWORD}'
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
}
EOL

# Start both instances with PM2
pm2 start ecosystem.config.js
pm2 save

# Setup PM2 startup script
pm2 startup
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ec2-user --hp /home/ec2-user

# Display status
pm2 status
pm2 startup
