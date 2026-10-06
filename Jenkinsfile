pipeline {
    agent any

    environment {
        DOCKERHUB_USER = 'ajaysunkaranam'
        IMAGE_NAME     = "${DOCKERHUB_USER}/node-practice-app"
        IMAGE_TAG      = "${env.BUILD_NUMBER}"
        GIT_REPO       = 'github.com/ajaysunkaranam89-ai/devops_test.git'
    }

    options {
        disableConcurrentBuilds()
        timestamps()
    }

    stages {
        stage('Check commit') {
            // Jenkins' own manifest-update commit must not start another release (avoids a loop)
            steps {
                script {
                    def msg = sh(script: 'git log -1 --pretty=%B', returnStdout: true).trim()
                    env.SKIP_CI = msg.contains('[skip ci]') ? 'true' : 'false'
                    if (env.SKIP_CI == 'true') {
                        currentBuild.description = 'Skipped: manifest-update commit'
                        echo 'Latest commit was made by Jenkins - nothing to release.'
                    }
                }
            }
        }

        stage('Release') {
            when { environment name: 'SKIP_CI', value: 'false' }
            stages {
                stage('Test') {
                    // Runs `npm test` inside the Dockerfile's "test" stage - build fails if tests fail
                    steps {
                        sh "docker build --target test -t ${IMAGE_NAME}:test ."
                    }
                }

                stage('SonarQube Analysis') {
                    // Scanner runs as a throw-away container in the dind daemon; the workspace is copied in
                    // with docker cp (dind can't see /var/jenkins_home). Settings live in
                    // sonar-project.properties. sonar.qualitygate.wait=true fails this stage if the gate fails.
                    steps {
                        withCredentials([usernamePassword(credentialsId: 'Sonarcube', usernameVariable: 'SONAR_USER', passwordVariable: 'SONAR_PASS')]) {
                            sh '''
                                export SONAR_TOKEN="$SONAR_PASS"
                                CID=$(docker create --network host \
                                    -e SONAR_HOST_URL=http://sonarqube.sonarqube.svc.cluster.local:9000 \
                                    -e SONAR_TOKEN \
                                    sonarsource/sonar-scanner-cli -Dsonar.qualitygate.wait=true)
                                trap 'docker rm -f "$CID" >/dev/null 2>&1' EXIT
                                docker cp . "$CID":/usr/src
                                docker start -a "$CID"
                            '''
                        }
                    }
                }

                stage('Build Image') {
                    steps {
                        sh "docker build --target prod -t ${IMAGE_NAME}:${IMAGE_TAG} ."
                    }
                }

                stage('Push Image') {
                    steps {
                        withCredentials([usernamePassword(credentialsId: 'docker_auth',
                                                          usernameVariable: 'DH_USER',
                                                          passwordVariable: 'DH_PASS')]) {
                            sh '''
                                echo "$DH_PASS" | docker login -u "$DH_USER" --password-stdin
                                docker push ${IMAGE_NAME}:${IMAGE_TAG}
                                docker logout
                            '''
                        }
                    }
                }

                stage('Update K8s Manifest (GitOps)') {
                    steps {
                        withCredentials([usernamePassword(credentialsId: 'git',
                                                          usernameVariable: 'GH_USER',
                                                          passwordVariable: 'GH_TOKEN')]) {
                            sh '''
                                urlencode() { printf '%s' "$1" | sed -e 's/%/%25/g' -e 's/@/%40/g' -e 's/:/%3A/g' -e 's#/#%2F#g' -e 's/ /%20/g'; }
                                GH_USER_ENC=$(urlencode "${GH_USER}")
                                GH_TOKEN_ENC=$(urlencode "${GH_TOKEN}")
                                SHORT_SHA=$(git rev-parse --short HEAD)
                                REPO_URL="https://${GH_USER_ENC}:${GH_TOKEN_ENC}@${GIT_REPO}"

                                git config user.email "jenkins@local"
                                git config user.name  "Jenkins"

                                # Jenkins checks out a detached HEAD - move onto the latest main
                                git fetch "$REPO_URL" main
                                git checkout -B main FETCH_HEAD

                                sed -i "s|image: .*node-practice-app:.*|image: ${IMAGE_NAME}:${IMAGE_TAG}|" k8s/deployment.yaml
                                sed -i "/name: APP_VERSION/{n;s|value: .*|value: \\"${IMAGE_TAG}\\"|}" k8s/deployment.yaml
                                sed -i "/name: GIT_COMMIT/{n;s|value: .*|value: \\"${SHORT_SHA}\\"|}" k8s/deployment.yaml

                                git add k8s/deployment.yaml
                                git commit -m "Deploy image ${IMAGE_TAG} [skip ci]"
                                git push "$REPO_URL" main
                            '''
                        }
                    }
                }
            }
        }
    }

    post {
        success {
            script {
                if (env.SKIP_CI == 'false') {
                    echo "Pushed ${IMAGE_NAME}:${IMAGE_TAG}. Argo CD will now sync it to the kind cluster."
                }
            }
        }
        cleanup {
            sh "docker rmi ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:test >/dev/null 2>&1 || true"
        }
    }
}
