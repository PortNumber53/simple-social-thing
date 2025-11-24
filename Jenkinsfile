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
          sh label: 'Deploy via script', script: 'bash deploy/jenkins-deploy-amd64.sh'
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


