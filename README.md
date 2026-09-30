# Node Practice App — GitHub → Jenkins → Argo CD → Kubernetes

A tiny Node.js (Express) web app with a dashboard that **visualises the DevOps pipeline it runs through**.
Use it to learn the complete CI/CD + GitOps flow end to end.

```
 You ──git push──▶ GitHub ──webhook──▶ Jenkins ──docker push──▶ Docker Hub
                     ▲                    │
                     │   commits new tag  │
                     └──── k8s/deployment.yaml ◀┘
                     │
                  Argo CD (watches k8s/) ──kubectl apply──▶ Kubernetes (pods + service)
```

- **CI (Jenkins):** test → build image → push image → write the new tag into `k8s/deployment.yaml`
- **CD (Argo CD):** notices the git change → syncs the cluster to match git (GitOps)

## Project layout

| Path | Purpose |
|---|---|
| `src/app.js` | Express app: `/`, `/health`, `/api/info` |
| `src/server.js` | Starts the server, handles graceful shutdown (SIGTERM) |
| `src/public/` | The dashboard UI (HTML/CSS/JS) |
| `test/app.test.js` | Unit tests (Node's built-in test runner) |
| `Dockerfile` | Multi-stage: `test` stage runs tests, `prod` stage is the runtime image |
| `Jenkinsfile` | CI pipeline |
| `jenkins/Dockerfile` | Jenkins image with a current Docker CLI, used to run Jenkins locally |
| `KIND_DEPLOYMENT_GUIDE.md` | Step-by-step guide for deploying to a kind cluster |
| `k8s/` | Kubernetes manifests (Namespace, Deployment, Service) — Argo CD watches this folder |
| `argocd/application.yaml` | Tells Argo CD what to deploy and where |

---

# Roadmap — step by step

> **Using a kind cluster?** Follow **[KIND_DEPLOYMENT_GUIDE.md](KIND_DEPLOYMENT_GUIDE.md)**, the complete kind-specific walkthrough with exact commands.

Tick these off in the **Learning checklist** on the dashboard as you go.

## Phase 0 — Prerequisites (Windows)

Install: **Git**, **Node.js 20+**, **Docker Desktop**, **kubectl**, and **kind** (or minikube / Docker Desktop's built-in Kubernetes).
Create free accounts on **GitHub** and **Docker Hub**.

```bash
node -v
docker -v
kubectl version --client
```

## Phase 1 — Run the app locally

```bash
cd node-practice-app
npm install
npm test
npm start
```

Open http://localhost:3000. Click **Simulate a release** and each pipeline stage to read what it does.

**Learn:** what `package.json`, `npm ci`, and a `/health` endpoint are for.

## Phase 2 — Docker

```bash
docker build --target test -t node-practice-app:test .
docker build --target prod -t node-practice-app:local .
docker run -d -p 8080:3000 -e APP_VERSION=docker-test --name npa node-practice-app:local
```

Open http://localhost:8080. The badge shows `build docker-test`, and the hostname is now the container ID.

```bash
docker rm -f npa
```

**Learn:** image layers, multi-stage builds, why the container runs as `USER node`.

## Phase 3 — GitHub

1. Create an empty repo on GitHub named `node-practice-app` (no README).
2. Replace the placeholders:
   - `Jenkinsfile` → `DOCKERHUB_USER` and `GITHUB_USER`
   - `k8s/deployment.yaml` → `DOCKERHUB_USER`
   - `argocd/application.yaml` → `GITHUB_USER`
3. Push:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/GITHUB_USER/node-practice-app.git
git push -u origin main
```

4. Create a **Personal Access Token** (GitHub → Settings → Developer settings → Fine-grained tokens) with **Contents: Read and write** on this repo. Jenkins uses it to push the manifest update.

**Learn:** branches, commits, PATs, why the k8s manifests live in git (single source of truth).

## Phase 4 — Jenkins

### 4.1 Run Jenkins in Docker, with access to Docker

```bash
docker build -t jenkins-docker:lts jenkins
docker run -d --name jenkins --restart unless-stopped -p 8081:8080 -p 50000:50000 -v jenkins_home:/var/jenkins_home -v /var/run/docker.sock:/var/run/docker.sock jenkins-docker:lts
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

(`jenkins/Dockerfile` adds a current Docker CLI. Debian's `docker.io` package is too old for Docker 25+.)

Open http://localhost:8081, paste the password, and choose **Install suggested plugins**.

> Mounting `docker.sock` lets Jenkins use your host's Docker. That's fine for practice, but don't do it in production.

### 4.2 Add credentials

**Manage Jenkins → Credentials → System → Global → Add Credentials** (Kind: *Username with password*):

| ID | Username | Password |
|---|---|---|
| `dockerhub-creds` | Docker Hub username | Docker Hub **access token** (Account settings → Security) |
| `github-creds` | GitHub username | GitHub PAT from Phase 3 |

### 4.3 Create the pipeline job

**New Item → `node-practice-app` → Pipeline**:
- *Build Triggers:* ✅ **GitHub hook trigger for GITScm polling**
- *Pipeline:* **Pipeline script from SCM** → Git → repo URL → credentials `github-creds` → branch `*/main` → Script Path `Jenkinsfile`

Click **Build Now** and watch **Console Output**. You should see: Checkout → Test → Build Image → Push Image → Update K8s Manifest.
Check Docker Hub for the new tag, and GitHub for a commit named `Deploy image N [skip ci]`.

### 4.4 Trigger builds automatically

GitHub can't reach `localhost`, so either:
- expose Jenkins with a tunnel (e.g. `ngrok http 8081`) and add a webhook in **GitHub repo → Settings → Webhooks** with URL `https://<tunnel>/github-webhook/` and content type `application/json`, **or**
- use **Poll SCM** with the schedule `H/2 * * * *` (checks every 2 min — easiest for practice).

**Learn:** declarative pipelines, stages, credentials binding, and why `[skip ci]` prevents an endless build loop.

## Phase 5 — Kubernetes

```bash
kind create cluster --name practice
kubectl get nodes
```

Try deploying by hand once, so you know what Argo CD will automate:

```bash
kubectl apply -f k8s/
kubectl -n practice get pods,svc
kubectl -n practice port-forward svc/node-practice-app 8090:80
```

Open http://localhost:8090 and click **Send 20 requests**. Two pod names share the traffic (`replicas: 2`).
Then remove the resources, because Argo CD will own them from now on:

```bash
kubectl delete -f k8s/
```

**Learn:** Pods, Deployments, ReplicaSets, Services, probes, resource limits, `kubectl describe`, `kubectl logs`.

## Phase 6 — Argo CD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd get pods -w
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}"
kubectl -n argocd port-forward svc/argocd-server 8443:443
```

The password prints base64-encoded. Decode it (e.g. in PowerShell: `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("<value>"))`), then log in at https://localhost:8443 as `admin`.

Register the app:

```bash
kubectl apply -f argocd/application.yaml
```

In the Argo CD UI, the app goes **OutOfSync → Syncing → Synced / Healthy**, and you can see the tree of Deployment → ReplicaSet → Pods.

> Private repo? Add it first in **Settings → Repositories** with your PAT.

**Learn:** desired state vs. live state, auto-sync, `prune`, `selfHeal`.

## Phase 7 — The full loop 🎉

1. Edit `src/public/index.html`, e.g. change `<h1>DevOps Pipeline</h1>`.
2. `git commit -am "change title" && git push`
3. Watch: **Jenkins** builds (e.g. #5), then **Docker Hub** gets tag `5`, then **GitHub** gets the `Deploy image 5 [skip ci]` commit, then **Argo CD** syncs, then **Kubernetes** rolls out new pods.
4. Refresh the app: the badge shows `build 5` and the pod names are new.

## Phase 8 — Experiments

| Try this | What you'll learn |
|---|---|
| Break a test, then push | CI stops the bad code; nothing gets deployed |
| `kubectl -n practice scale deploy/node-practice-app --replicas=5` | Argo CD **self-heal** sets it back to 2 |
| Change `replicas: 3` in git and push | GitOps — git changes the cluster |
| `git revert HEAD` on a deploy commit | **Rollback** through git |
| Delete a pod | The Deployment recreates it |
| Break `/health` (return 500) | Readiness probes keep traffic away from bad pods |
| Add an Ingress + TLS (cert-manager) | Real domain routing, like in production |

## Troubleshooting

| Problem | Fix |
|---|---|
| Jenkins: `docker: not found` / `client version too old` | Use the `jenkins-docker:lts` image built from `jenkins/Dockerfile` |
| Jenkins: `permission denied ... docker.sock` | The container must run as root (the provided image does) |
| Push to GitHub fails in Jenkins | Your PAT needs **Contents: write**; check `GIT_REPO` in the Jenkinsfile |
| Pods `ImagePullBackOff` | Wrong image name/tag in `k8s/deployment.yaml`, or the Docker Hub repo is private |
| Argo CD stuck `OutOfSync` | Click **Refresh** → **Sync**; check the `repoURL` and the `path: k8s` |
| Builds loop forever | Make sure the manifest commit message contains `[skip ci]` |
