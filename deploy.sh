#!/bin/bash

# Install Chrome
sudo yum update -y
sudo yum install -y google-chrome-stable

# Install Node.js 18.x
curl -sL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Create app directory
mkdir -p /home/ec2-user/app
mkdir -p /home/ec2-user/app/user_data
mkdir -p /home/ec2-user/app/logs

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
  apps: [{
    name: 'upwork-scraper',
    script: 'app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      REDIS_HOST: '${REDIS_HOST}',
      REDIS_PORT: '${REDIS_PORT}',
      REDIS_USERNAME: '${REDIS_USERNAME}',
      REDIS_PASSWORD: '${REDIS_PASSWORD}',
      UPWORK_EMAIL: '${UPWORK_EMAIL}',
      UPWORK_PASSWORD: '${UPWORK_PASSWORD}'
    }
  }]
}
EOL

# Start the application with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
