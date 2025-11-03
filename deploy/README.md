# Deployment Configuration

This directory contains the Jenkins pipeline and deployment scripts for Simple Social Thing.

## Jenkins Pipeline

The `Jenkinsfile` defines a multi-architecture build pipeline that:

1. **Builds** Go binaries for both `amd64` and `arm64` architectures
2. **Runs database migrations** (if `DATABASE_URL` is set)
3. **Deploys** the `amd64` binary to `web1` server

### Environment Variables

Configure these in Jenkins:

- `TARGET_HOST` - SSH hostname (default: `web1`)
- `TARGET_DIR` - Deployment directory (default: `/var/www/vhosts/simple.truvis.co`)
- `SERVICE_NAME` - Systemd service name (default: `simple-social-thing`)
- `SSH_CREDENTIALS` - Jenkins credential ID for SSH key (default: `brain-jenkins-private-key`)
- `DATABASE_URL` - Database connection string (optional, for migrations)

### Jenkins Credentials

Required Jenkins credentials:

1. **SSH Key** (`brain-jenkins-private-key`)
   - Type: SSH Username with private key
   - Username: `grimlock`
   - Private key: SSH key for accessing web1

2. **Database URL** (optional, `DATABASE_URL`)
   - Type: Secret text
   - Value: PostgreSQL connection string

### Pipeline Stages

1. **Checkout** - Clones the repository
2. **Build Matrix** - Builds binaries for amd64 and arm64
3. **DB Migrate** - Runs database migrations (if DATABASE_URL is set)
4. **Deploy** - Deploys amd64 binary to web1 and restarts the service

## Server Setup

### Automated Setup

The Jenkins pipeline automatically handles most of the server setup:

1. **Creates deployment directories:**
   - `/var/www/vhosts/simple.truvis.co`
   - `/var/www/vhosts/simple.truvis.co/logs`

2. **Creates config directory:**
   - `/etc/simple-social-thing`

3. **Initializes config file (first deployment only):**
   - Copies `config.ini.sample` to `/etc/simple-social-thing/config.ini`
   - Sets ownership to `root:grimlock`
   - Sets permissions to `640`
   - **Does NOT overwrite existing config files**

### Manual Configuration Required

After the first deployment, you must edit the config file with your actual values:

```bash
sudo nano /etc/simple-social-thing/config.ini
```

Update the `DATABASE_URL` with your actual database connection string:

```ini
# Simple Social Thing Configuration
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
```

Then restart the service:

```bash
sudo systemctl restart simple-social-thing
```

### Prerequisites on Target Server (web1)

The only prerequisite is SSH access for the `grimlock` user with sudo privileges. The pipeline handles everything else automatically.

### Systemd Service

The pipeline automatically creates and manages the systemd service:

- **Service file:** `/etc/systemd/system/simple-social-thing.service`
- **Binary location:** `/var/www/vhosts/simple.truvis.co/simple-social-thing`
- **Logs:** `/var/www/vhosts/simple.truvis.co/logs/`
- **Port:** `18002`

### Manual Service Management

```bash
# Check status
sudo systemctl status simple-social-thing

# View logs
sudo journalctl -u simple-social-thing -f

# Restart service
sudo systemctl restart simple-social-thing

# View application logs
tail -f /var/www/vhosts/simple.truvis.co/logs/app.log
tail -f /var/www/vhosts/simple.truvis.co/logs/error.log
```

## Database Migrations

Migrations are run automatically during deployment if `DATABASE_URL` is set in Jenkins.

### Manual Migration

To run migrations manually:

```bash
cd backend
DATABASE_URL="postgresql://..." go run db/migrate.go -direction=up
```

Or use the migration script:

```bash
DATABASE_URL="postgresql://..." bash deploy/dbtool-migrate.sh
```

## Build Artifacts

The pipeline produces the following artifacts:

- `artifacts/simple-social-thing-linux-amd64` - Linux binary for x86_64
- `artifacts/simple-social-thing-linux-arm64` - Linux binary for ARM64

## Deployment Flow

1. Developer pushes code to repository
2. Jenkins detects the change and triggers the pipeline
3. Pipeline builds binaries for both architectures
4. Pipeline runs database migrations (if configured)
5. Pipeline deploys amd64 binary to web1
6. Service is automatically restarted
7. Application is live on port 18002

## Troubleshooting

### Build Fails

- Check Go version compatibility
- Verify `go.mod` and dependencies
- Review build logs in Jenkins

### Deployment Fails

- Verify SSH credentials in Jenkins
- Check target server connectivity
- Ensure deployment directory exists and has correct permissions
- Verify systemd service configuration

### Service Won't Start

- Check logs: `sudo journalctl -u simple-social-thing -f`
- Verify config file exists: `/etc/simple-social-thing/config.ini`
- Check binary permissions: `ls -l /var/www/vhosts/simple.truvis.co/simple-social-thing`
- Test binary manually: `/var/www/vhosts/simple.truvis.co/simple-social-thing`

### Database Connection Issues

- Verify `DATABASE_URL` in config file
- Test connection from server: `psql "$DATABASE_URL"`
- Check firewall rules
- Verify database credentials
