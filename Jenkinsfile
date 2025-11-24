// Declarative Pipeline with a build matrix ready for CI and multi-arch
// Builds Linux binaries for amd64 and arm64; deploys amd64 to web1.

pipeline {
  agent any

  options {
    timestamps()
    ansiColor('xterm')
    skipDefaultCheckout(false)
  }

  environment {
    GO111MODULE = 'on'
    // Deployment targets
    TARGET_HOST    = 'web1'
    TARGET_DIR     = '/var/www/vhosts/simple.truvis.co'
    SERVICE_NAME   = 'simple-social-thing'
    SSH_CREDENTIALS = 'brain-jenkins-private-key'  // Jenkins credential ID (Username with private key)
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
      when { expression { return env.DATABASE_URL?.trim() } }
      steps {
        sh label: 'dbtool diagnostics', script: '''
          set -euo pipefail
          echo "dbtool version: $(dbtool --version || echo not-found)"
        '''
        sh 'bash deploy/dbtool-migrate.sh'
      }
    }

    stage('Deploy (amd64 → web1)') {
      steps {
        unstash "bin-amd64"
        sshagent(credentials: [env.SSH_CREDENTIALS]) {
          sh label: 'Upload & install', script: '''
            set -euo pipefail
            BIN_LOCAL="artifacts/simple-social-thing-linux-amd64"
            # Upload binary, config sample, and unit file to /tmp on target
            scp "$BIN_LOCAL" grimlock@${TARGET_HOST}:/tmp/simple-social-thing
            scp deploy/config.ini.sample grimlock@${TARGET_HOST}:/tmp/config.ini.sample
            cat > simple-social-thing.service << 'EOF'
[Unit]
Description=Simple Social Thing
After=network-online.target
[Service]
User=grimlock
Group=grimlock
WorkingDirectory=${TARGET_DIR}
EnvironmentFile=/etc/simple-social-thing/config.ini
Environment=PORT=18002
ExecStart=${TARGET_DIR}/simple-social-thing
Restart=always
RestartSec=2s
NoNewPrivileges=true
LimitNOFILE=65536
StandardOutput=append:${TARGET_DIR}/logs/app.log
StandardError=append:${TARGET_DIR}/logs/error.log
[Install]
WantedBy=multi-user.target
EOF
            scp simple-social-thing.service grimlock@${TARGET_HOST}:/tmp/simple-social-thing.service

            # Prepare target and (re)start service
            ssh grimlock@${TARGET_HOST} "
              set -euo pipefail
              
              # Create application directories
              sudo mkdir -p ${TARGET_DIR} ${TARGET_DIR}/logs
              sudo chown -R grimlock:grimlock ${TARGET_DIR}
              
              # Setup config directory and file
              sudo mkdir -p /etc/simple-social-thing
              
              # Only copy sample config if config.ini doesn't exist
              if [ ! -f /etc/simple-social-thing/config.ini ]; then
                echo 'Config file does not exist, creating from sample...'
                sudo cp /tmp/config.ini.sample /etc/simple-social-thing/config.ini
                sudo chown root:grimlock /etc/simple-social-thing/config.ini
                sudo chmod 640 /etc/simple-social-thing/config.ini
                echo 'WARNING: Please edit /etc/simple-social-thing/config.ini with your actual values!'
              else
                echo 'Config file already exists, skipping...'
              fi
              
              # Clean up temp config sample
              rm -f /tmp/config.ini.sample
              
              # Install binary
              sudo mv /tmp/simple-social-thing ${TARGET_DIR}/simple-social-thing
              sudo chown grimlock:grimlock ${TARGET_DIR}/simple-social-thing
              sudo chmod 0755 ${TARGET_DIR}/simple-social-thing
              
              # Install and restart service
              sudo mv /tmp/simple-social-thing.service /etc/systemd/system/${SERVICE_NAME}.service
              sudo systemctl daemon-reload
              sudo systemctl enable ${SERVICE_NAME}
              sudo systemctl restart ${SERVICE_NAME}
            "
          '''
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


