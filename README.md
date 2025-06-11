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

### Alternating Schedule System
The application uses two instances that alternate operation based on even/odd hours:
- Even instance: Runs during even hours (0, 2, 4, ..., 22)
- Odd instance: Runs during odd hours (1, 3, 5, ..., 23)

This setup ensures:
- Continuous operation with balanced workload
- Automatic failover (if one instance fails, the other takes over in its hour)
- Regular cleanup and resource management opportunities

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
# View all logs
pm2 logs

# View specific instance logs
pm2 logs upwork-scraper-even    # Even instance logs
pm2 logs upwork-scraper-odd     # Odd instance logs

# Monitor all instances
pm2 monit

# Restart specific instance
pm2 restart upwork-scraper-even
pm2 restart upwork-scraper-odd

# Start/Stop specific instance
pm2 stop upwork-scraper-even
pm2 start upwork-scraper-even
```

### Directory Structure
- `/home/ec2-user/app` - Application root
- `/home/ec2-user/app/user_data` - Chrome user data
- `/home/ec2-user/app/logs` - Application logs
  - `/even` - Even instance logs
  - `/odd` - Odd instance logs

### Instance Schedule
The application uses two instances that alternate operation:
- Even instance (upwork-scraper-even): Active during even hours (0, 2, 4, ..., 22)
- Odd instance (upwork-scraper-odd): Active during odd hours (1, 3, 5, ..., 23)

### Health Monitoring
The application includes a health check endpoint at `http://localhost:3000/health` that returns:
- Current status
- Instance type (even/odd)
- Uptime
- Memory usage
- Timestamp

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

3. If an instance is not switching properly:
- Check instance logs: `pm2 logs upwork-scraper-even` or `pm2 logs upwork-scraper-odd`
- Verify system time is correct: `date`
- Restart problematic instance: `pm2 restart upwork-scraper-even`

4. If both instances are running simultaneously:
- Check logs for scheduling issues
- Restart both instances:
```bash
pm2 restart upwork-scraper-even upwork-scraper-odd
```

5. To check instance status and scheduling:
```bash
# View all instance details
pm2 show upwork-scraper-even
pm2 show upwork-scraper-odd

# Monitor real-time status
pm2 monit
```
