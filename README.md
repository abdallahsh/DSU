# Upwork Job Scraper

## Production Deployment (AWS EC2)

### Prerequisites
- AWS EC2 instance (Recommended: t2.medium or better)
- Amazon Linux 2
- Redis instance (AWS ElastiCache or standalone)

### System Requirements
- Node.js 18.x or later
- Google Chrome
- 2GB RAM minimum
- 20GB storage

### Setup Instructions

1. Clone the repository:
```bash
git clone <your-repo-url>
cd <repo-directory>
```

2. Create production environment file:
```bash
cat > .env.production << EOL
NODE_ENV=production
REDIS_HOST=your-redis-host
REDIS_PORT=your-redis-port
REDIS_USERNAME=your-redis-username
REDIS_PASSWORD=your-redis-password
UPWORK_EMAIL=your-upwork-email
UPWORK_PASSWORD=your-upwork-password
EOL
```

3. Install dependencies and run deployment script:
```bash
chmod +x deploy.sh
./deploy.sh
```

### Monitoring and Maintenance

The application uses PM2 for process management. Common commands:

```bash
# View logs
pm2 logs upwork-scraper

# Monitor application
pm2 monit

# Restart application
pm2 restart upwork-scraper

# View status
pm2 status
```

### Directory Structure
- `/home/ec2-user/app` - Application root
- `/home/ec2-user/app/user_data` - Chrome user data
- `/home/ec2-user/app/logs` - Application logs

### Troubleshooting

1. If Chrome fails to start:
```bash
sudo yum update -y
sudo yum install -y google-chrome-stable
```

2. If Redis connection fails:
- Check security group rules
- Verify Redis credentials
- Ensure Redis is running: `redis-cli ping`

3. If scraping fails:
- Check Chrome logs: `tail -f /home/ec2-user/app/logs/chrome-out.log`
- Check application logs: `pm2 logs upwork-scraper`
