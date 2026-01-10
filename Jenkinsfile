// Declarative Pipeline with a build matrix ready for CI and multi-arch
// Builds Linux binaries for amd64 and arm64; deploys amd64 to web1.

pipeline {
  agent any

  options {
    timestamps()
    skipDefaultCheckout(false)
  }

  environment {
    GO111MODULE = 'on'
    // Backend deployment targets
    TARGET_DIR     = '/var/www/vhosts/api-simple.truvis.co'
    SERVICE_NAME   = 'api-simple-social-thing'
    SSH_CREDENTIALS = 'brain-jenkins-private-key'  // Jenkins credential ID (Username with private key)

    // Machines listed in NOTES.md
    BACKEND_AMD64_HOSTS = 'web1'
    BACKEND_AMD64_SSH_USER = 'grimlock'
    BACKEND_AMD64_SSH_PORT = '22987'

    // Oracle - Ubuntu - ARM64 machines
    BACKEND_ARM64_HOSTS = '163.192.9.21 129.146.3.224 150.136.217.87 164.152.111.231 168.138.152.114 144.24.200.77'
    BACKEND_ARM64_SSH_USER = 'grimlock'
    BACKEND_ARM64_SSH_PORT = '22'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git rev-parse --short HEAD'
      }
    }

    stage('Build Matrix') {
      matrix {
        axes {
          axis {
            name 'GOARCH'
            values 'amd64', 'arm64'
          }
        }
        stages {
          stage('Build') {
            steps {
              dir('backend') {
                sh label: 'Go build', script: '''
                  set -euo pipefail
                  go version || true
                  export GOOS=linux
                  export CGO_ENABLED=0
                  echo "Building for $GOOS/$GOARCH"
                  out="simple-social-thing-${GOOS}-${GOARCH}"
                  go build -ldflags="-s -w" -o "$out" ./cmd/api
                '''
              }
            }
          }
          stage('Archive') {
            steps {
              sh '''
                set -euo pipefail
                mkdir -p artifacts
                cp backend/simple-social-thing-linux-${GOARCH} artifacts/
              '''
              stash name: "bin-${GOARCH}", includes: "artifacts/simple-social-thing-linux-${GOARCH}"
            }
          }
        }
        post {
          success {
            echo "Built ${GOARCH} successfully"
          }
        }
      }
    }

    stage('DB Migrate (All)') {
      when { branch 'master' }
      steps {
        withCredentials([
          string(credentialsId: 'prod-database-url-simple-social-thing', variable: 'DATABASE_URL')
        ]) {
        sh label: 'dbtool diagnostics', script: '''
          set -euo pipefail
          echo "dbtool version: $(dbtool --version || echo not-found)"
        '''
        sh 'bash deploy/dbtool-migrate.sh'
        }
      }
    }

    stage('Deploy (parallel)') {
      when { branch 'master' }
      parallel {
        stage('Deploy Backend (amd64 → web1)') {
      steps {
        unstash "bin-amd64"
            withCredentials([
              string(credentialsId: 'prod-database-url-simple-social-thing', variable: 'DATABASE_URL'),
              string(credentialsId: 'prod-log-level-simple-social-thing', variable: 'LOG_LEVEL'),
              string(credentialsId: 'prod-backend-url-simple-social-thing', variable: 'PUBLIC_ORIGIN')
            ]) {
              sshagent(credentials: [env.SSH_CREDENTIALS]) {
                sh label: 'Deploy via script', script: '''
                  set -euo pipefail
                  GOARCH=amd64 \
                  TARGET_HOSTS="$BACKEND_AMD64_HOSTS" \
                  SSH_USER="$BACKEND_AMD64_SSH_USER" \
                  SSH_PORT="$BACKEND_AMD64_SSH_PORT" \
                  TARGET_DIR="$TARGET_DIR" \
                  SERVICE_NAME="$SERVICE_NAME" \
                  DATABASE_URL="$DATABASE_URL" \
                  LOG_LEVEL="$LOG_LEVEL" \
                  PUBLIC_ORIGIN="$PUBLIC_ORIGIN" \
                  APP_PORT="18911" \
                  ENVIRONMENT_NAME="production" \
                  bash deploy/jenkins-deploy-amd64.sh
                '''
              }
            }
          }
        }

        stage('Deploy Backend (arm64 → Oracle fleet)') {
          when {
            expression {
              return env.DEPLOY_ORACLE_FLEET == 'true'
            }
          }
          steps {
            unstash "bin-arm64"
            withCredentials([
              string(credentialsId: 'prod-database-url-simple-social-thing', variable: 'DATABASE_URL'),
              string(credentialsId: 'prod-log-level-simple-social-thing', variable: 'LOG_LEVEL'),
              string(credentialsId: 'prod-backend-url-simple-social-thing', variable: 'PUBLIC_ORIGIN')
            ]) {
        sshagent(credentials: [env.SSH_CREDENTIALS]) {
                sh label: 'Deploy via script', script: '''
                  set -euo pipefail
                  GOARCH=arm64 \
                  TARGET_HOSTS="$BACKEND_ARM64_HOSTS" \
                  SSH_USER="$BACKEND_ARM64_SSH_USER" \
                  SSH_PORT="$BACKEND_ARM64_SSH_PORT" \
                  TARGET_DIR="$TARGET_DIR" \
                  SERVICE_NAME="$SERVICE_NAME" \
                  DATABASE_URL="$DATABASE_URL" \
                  LOG_LEVEL="$LOG_LEVEL" \
                  PUBLIC_ORIGIN="$PUBLIC_ORIGIN" \
                  APP_PORT="18911" \
                  ENVIRONMENT_NAME="production" \
                  bash deploy/jenkins-deploy-amd64.sh
                '''
              }
            }
          }
        }

        stage('Deploy Frontend (Cloudflare)') {
          steps {
            withCredentials([
              string(credentialsId: 'cloudflare-api-token', variable: 'CLOUDFLARE_API_TOKEN'),
              string(credentialsId: 'prod-google-client-id-simple-social-thing', variable: 'GOOGLE_CLIENT_ID'),
              string(credentialsId: 'prod-google-client-secret-simple-social-thing', variable: 'GOOGLE_CLIENT_SECRET'),
              string(credentialsId: 'prod-instagram-app-id-simple-social-thing', variable: 'INSTAGRAM_APP_ID'),
              string(credentialsId: 'prod-instagram-app-secret-simple-social-thing', variable: 'INSTAGRAM_APP_SECRET'),
              string(credentialsId: 'prod-tiktok-client-key-simple-social-thing', variable: 'TIKTOK_CLIENT_KEY'),
              string(credentialsId: 'prod-tiktok-client-secret-simple-social-thing', variable: 'TIKTOK_CLIENT_SECRET'),
              string(credentialsId: 'prod-pinterest-client-id-simple-social-thing', variable: 'PINTEREST_CLIENT_ID'),
              string(credentialsId: 'prod-pinterest-client-secret-simple-social-thing', variable: 'PINTEREST_CLIENT_SECRET'),
              string(credentialsId: 'prod-facebook-webhook-token-simple-social-thing', variable: 'FACEBOOK_WEBHOOK_TOKEN'),
              string(credentialsId: 'prod-jwt-secret-simple-social-thing', variable: 'JWT_SECRET'),
              string(credentialsId: 'prod-stripe-secret-key-simple-social-thing', variable: 'STRIPE_SECRET_KEY'),
              string(credentialsId: 'prod-stripe-publishable-key-simple-social-thing', variable: 'STRIPE_PUBLISHABLE_KEY'),
              string(credentialsId: 'prod-stripe-webhook-secret-simple-social-thing', variable: 'STRIPE_WEBHOOK_SECRET'),
              string(credentialsId: 'prod-database-url-simple-social-thing', variable: 'DATABASE_URL'),
              string(credentialsId: 'prod-backend-url-simple-social-thing', variable: 'BACKEND_ORIGIN'),
              string(credentialsId: 'prod-log-level-simple-social-thing', variable: 'LOG_LEVEL'),
            ]) {
              sh label: 'Deploy frontend via wrangler', script: 'bash deploy/jenkins-deploy-frontend.sh'
            }
          }
        }
      }
    }
  }

  post {
    success { echo 'Pipeline completed successfully.' }
    failure { echo 'Pipeline failed.' }
    always  { sh 'ls -lah artifacts || true' }
  }
}
