# Deploying node-practice-app to a kind cluster
## GitHub → Jenkins → Docker Hub → Argo CD → kind (Kubernetes)

This is the complete hands-on flow for **your existing kind cluster** on Windows + Docker Desktop.
All commands run in **PowerShell** from the `node-practice-app` folder unless stated otherwise.

```
┌────────────┐ git push ┌────────┐  poll/webhook  ┌─────────────────────────┐
│ Your PC    │─────────▶│ GitHub │───────────────▶│ Jenkins (Docker)        │
│ (VS Code)  │          │  repo  │◀───────────────│ test → build → push     │
└────────────┘          └────────┘ commit new tag │ image → update manifest │
                             │   (k8s/…yaml)      └───────────┬─────────────┘
                             │ watches k8s/                   │ docker push
                             ▼                                ▼
                  ┌──────────────────────────┐        ┌──────────────┐
                  │ kind cluster             │  pull  │  Docker Hub  │
                  │  ├─ argocd  (Argo CD)    │◀───────│  <user>/     │
                  │  └─ practice (your app)  │ image  │  node-practice-app:N
                  └──────────────────────────┘        └──────────────┘
```

### Your cluster (read-only check, 2026-09-24)

| Item | Status | What it means for this guide |
|---|---|---|
| Cluster | `mycluster`, context `kind-mycluster`, 1 control-plane + 2 workers, k8s v1.37, all Ready | ✅ Ready to use |
| Argo CD | Already installed in `argocd`, all pods Running, managing `gps` and `python-app` | ✅ **Skip the install in Step 7.** Just log in |
| Jenkins in the cluster (`jenkins` ns) | `dind` sidecar crash-loops (`failed to start containerd: timeout`) | ⚠️ It can't build images. Use **Jenkins in Docker Desktop** (Step 5) on port 8081. The broken one is left alone |
| NodePort 30080 | Taken by the in-cluster Jenkins | The app's Service is **ClusterIP**, so there's no clash |
| Host port mappings | Only the API server (6443). No 80/443 | Use `kubectl port-forward` to reach the app |
| Ingress controller | None | Port-forward for now (Step 11B if you want one later) |
| Docker Desktop memory | 8 GB total, kind nodes use ~5 GB | Jenkins needs ~1 GB more. Close other containers if things get slow |

**Key idea:** Jenkins never talks to Kubernetes. It only updates **git**. Argo CD (inside kind) **pulls** changes from git and applies them. This is **GitOps**.

### Port plan (so nothing clashes)

| What | URL |
|---|---|
| App (local `npm start`) | http://localhost:3000 |
| Jenkins | http://localhost:8081 |
| Argo CD UI | https://localhost:8443 |
| App running in kind | http://localhost:8090 |

---

## Step 0 — Check your tools and cluster

```powershell
git --version
docker version
kubectl version --client
kind version
```

Find your cluster and point kubectl at it:

```powershell
kind get clusters
kubectl config get-contexts
kubectl config use-context kind-<your-cluster-name>
kubectl get nodes
```

All nodes should be `Ready`. Argo CD needs roughly **1.5 GB RAM** free in Docker Desktop (Settings → Resources).

> Every command below that starts with `kubectl` runs against the context you just selected. Double-check it's the kind one and not a real/production cluster:
> ```powershell
> kubectl config current-context
> ```

---

## Step 1 — Accounts & tokens (one-time)

1. **Docker Hub** (https://hub.docker.com)
   - Create the repository `node-practice-app` as **Public**, so kind can pull it without a secret.
   - Account Settings → Personal access tokens → **Generate** (Read & Write). Save it.
2. **GitHub** (https://github.com)
   - Create the repository `node-practice-app`, **empty** (no README/license).
   - Settings → Developer settings → Personal access tokens → **Fine-grained token**
     → Repository access: *only* `node-practice-app` → Permissions: **Contents = Read and write**. Save it.

---

## Step 2 — Personalise the code

Replace the placeholders with your real usernames:

| File | Replace |
|---|---|
| `Jenkinsfile` | `DOCKERHUB_USER`, `GITHUB_USER` |
| `k8s/deployment.yaml` | `DOCKERHUB_USER` |
| `argocd/application.yaml` | `GITHUB_USER` |

Or do it in one go (edit the two values first):

```powershell
$dh = "your-dockerhub-user"; $gh = "your-github-user"
(Get-Content Jenkinsfile)              -replace 'DOCKERHUB_USER', $dh -replace 'GITHUB_USER', $gh | Set-Content Jenkinsfile
(Get-Content k8s\deployment.yaml)      -replace 'DOCKERHUB_USER', $dh | Set-Content k8s\deployment.yaml
(Get-Content argocd\application.yaml)  -replace 'GITHUB_USER', $gh    | Set-Content argocd\application.yaml
```

Sanity check locally:

```powershell
npm install
npm test
npm start
```

Open http://localhost:3000, then stop the app with `Ctrl+C`.

---

## Step 3 — Push the code to GitHub

The app currently sits inside the bigger `D:\AD` repo. Copy it out so it becomes its own repo:

```powershell
robocopy D:\AD\node-practice-app D:\node-practice-app /E /XD node_modules
cd D:\node-practice-app
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-github-user>/node-practice-app.git
git push -u origin main
```

When Git asks for a password, paste your **GitHub token** (not your password).

From now on, work in `D:\node-practice-app`.

---

## Step 4 — First image by hand (so you know what Jenkins will do)

```powershell
docker login -u <your-dockerhub-user>
docker build --target test -t <your-dockerhub-user>/node-practice-app:test .
docker build --target prod -t <your-dockerhub-user>/node-practice-app:latest .
docker push <your-dockerhub-user>/node-practice-app:latest
```

For `docker login`, paste your Docker Hub token as the password. If the `test` build fails, a test failed. Jenkins will stop at the same point.

---

## Step 5 — Run Jenkins in Docker

### 5.1 Build a Jenkins image that has a current Docker CLI

```powershell
docker build -t jenkins-docker:lts jenkins
```

(Debian's own `docker.io` package is too old for Docker Desktop 25+ and fails with *"client version is too old"*. The image in `jenkins/Dockerfile` copies a current CLI.)

### 5.2 Start Jenkins

```powershell
docker run -d --name jenkins --restart unless-stopped -p 8081:8080 -p 50000:50000 -v jenkins_home:/var/jenkins_home -v /var/run/docker.sock:/var/run/docker.sock jenkins-docker:lts
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

- Open **http://localhost:8081**, paste the password, and choose **Install suggested plugins**.
- Create your admin user and keep the Jenkins URL as `http://localhost:8081/`.

Check that Jenkins can use Docker:

```powershell
docker exec jenkins docker ps
```

It should list your containers, including the kind node, e.g. `<cluster>-control-plane`.

### 5.3 Add credentials

**Manage Jenkins → Credentials → System → Global credentials → Add Credentials**
(Kind: **Username with password**, add each one separately):

| ID (type exactly) | Username | Password |
|---|---|---|
| `dockerhub-creds` | Docker Hub username | Docker Hub token |
| `github-creds` | GitHub username | GitHub token |

### 5.4 Create the pipeline job

1. **Dashboard → New Item** → name `node-practice-app` → **Pipeline** → OK
2. **Triggers:** ✅ **Poll SCM**, with Schedule `H/2 * * * *` (checks GitHub every ~2 min)
   > Webhooks can't reach `localhost`. Polling is the simplest option for a laptop. Optional webhook setup is in Step 11.
3. **Pipeline** section:
   - Definition: **Pipeline script from SCM**
   - SCM: **Git**
   - Repository URL: `https://github.com/<your-github-user>/node-practice-app.git`
   - Credentials: `github-creds`
   - Branch Specifier: `*/main`
   - Script Path: `Jenkinsfile`
4. **Save**, then click **Build Now**.

### 5.5 Watch the first build

Open the build, then **Console Output**. The stages are:

```
Check commit → Test → Build Image → Push Image → Update K8s Manifest (GitOps)
```

Check the results:
- **Docker Hub:** a new tag `1` exists.
- **GitHub:** a new commit `Deploy image 1 [skip ci]`, and `k8s/deployment.yaml` now says `image: <user>/node-practice-app:1`.
- About 2 min later, Jenkins polls, sees its own commit, and runs a quick build marked **"Skipped: manifest-update commit"**. That's expected and stops the loop.

Pull Jenkins' commit into your local copy:

```powershell
git pull
```

---

## Step 6 — (Optional) Deploy to kind by hand once

Do this once to see what Argo CD will automate:

```powershell
kubectl apply -f k8s/
kubectl -n practice get pods -w
kubectl -n practice port-forward svc/node-practice-app 8090:80
```

`get pods -w` watches until 2 pods are Running (press `Ctrl+C` to stop watching). Leave the `port-forward` running.

Open **http://localhost:8090**. The badge shows `build 1`. Click **Send 20 requests** and you'll see 2 different pod names.

Now clean up, so Argo CD can take ownership:

```powershell
kubectl delete -f k8s/
```

---

## Step 7 — Install Argo CD into kind

> **Your `mycluster` already has Argo CD running.** Skip the install and go straight to **"Get the admin password"** below. Your existing `gps` and `python-app` apps are untouched by this guide.
>
> If `argocd-initial-admin-secret` is missing (it's often deleted after first login), use the admin password you set earlier. To reset it, see the Argo CD docs' *"reset admin password"* FAQ.

Fresh cluster only:

```powershell
kubectl create namespace argocd
kubectl apply -n argocd --server-side -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd rollout status deploy/argocd-server
kubectl -n argocd get pods
```

Wait until every pod is `Running`. (`--server-side` avoids the "annotation too long" error on big CRDs.)

Get the admin password:

```powershell
$p = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}"
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))
```

Open the UI. Keep this in its own terminal window:

```powershell
kubectl -n argocd port-forward svc/argocd-server 8443:443
```

Go to **https://localhost:8443**. Accept the self-signed certificate warning, then log in as `admin` with the password above.

### Private GitHub repo?

If your repo is private, tell Argo CD how to read it: **Settings → Repositories → Connect Repo** → HTTPS → your repo URL → your GitHub username and token. Public repos skip this.

---

## Step 8 — Hand the app to Argo CD

```powershell
kubectl apply -f argocd/application.yaml
```

In the Argo CD UI, click the **node-practice-app** tile:
- The status goes **OutOfSync → Syncing → Synced**, and health goes **Progressing → Healthy**.
- The tree shows `Application → Deployment → ReplicaSet → 2 Pods`, plus the `Service`.

From the command line:

```powershell
kubectl -n argocd get applications
kubectl -n practice get all
```

Open the app:

```powershell
kubectl -n practice port-forward svc/node-practice-app 8090:80
```

Go to **http://localhost:8090**. The **Running pod** card shows the build number and git commit Jenkins wrote.

---

## Step 9 — The full automated loop 🎉

1. In `D:\node-practice-app`, edit `src/public/index.html`, e.g. change `<h1>DevOps Pipeline</h1>` to `<h1>My First GitOps Release</h1>`.
2. Commit and push:

```powershell
git commit -am "Change title"
git push
```

3. Watch each tool in turn:

| Where | What you'll see (≈ time) |
|---|---|
| **Jenkins** (localhost:8081) | New build #N starts within 2 min, then Test → Build → Push → Update manifest |
| **Docker Hub** | Tag `N` appears |
| **GitHub** | Commit `Deploy image N [skip ci]` |
| **Argo CD** (localhost:8443) | Within ~3 min it detects the commit and syncs. Click **Refresh** to see it sooner |
| **kubectl** | `kubectl -n practice get pods -w`: new pods start, old ones stop (rolling update) |
| **App** (localhost:8090) | Refresh: new title, badge `build N`, new pod names |

> The rolling update replaces pods, so `port-forward` may disconnect. Just run it again.

4. Run `git pull` so your local copy has Jenkins' manifest commit before your next change.

---

## Step 10 — Experiments (this is where you really learn)

| Experiment | Command / action | What happens |
|---|---|---|
| **Broken test** | Change an assertion in `test/app.test.js`, then push | Jenkins fails at **Test**. No image, no deploy. The cluster keeps running the old version |
| **Self-heal** | `kubectl -n practice scale deploy/node-practice-app --replicas=5` | Argo CD puts it back to 2 (git is the truth) |
| **Scale via git** | Set `replicas: 3` in `k8s/deployment.yaml`, commit with `[skip ci]` in the message, then push | Jenkins skips the build and Argo CD scales to 3 pods (git changes the cluster) |
| **Rollback** | `git revert <deploy-commit-sha>`, then `git push` | Argo CD redeploys the previous image tag |
| **Pod crash** | `kubectl -n practice delete pod <pod-name>` | The Deployment recreates it immediately |
| **Bad health check** | Make `/health` return 500, then push | Readiness fails and new pods never get traffic, so the rollout stalls. Roll back with git |
| **Drift detection** | `kubectl -n practice edit deploy node-practice-app` (change something) | Argo CD shows **OutOfSync**, then self-heals |
| **History** | Argo CD → app → **History and Rollback** | Every sync, linked to a git commit |

> **Note:** Every push to `main` that isn't a `[skip ci]` commit runs the full pipeline. If you only change YAML, Jenkins still builds a new image, and that's fine for practice. To manage YAML-only changes yourself, put `[skip ci]` in your commit message.

Useful debugging commands:

```powershell
kubectl -n practice describe pod <pod-name>
kubectl -n practice logs deploy/node-practice-app
kubectl -n practice get events --sort-by=.lastTimestamp
kubectl -n argocd logs deploy/argocd-repo-server
docker logs jenkins
```

---

## Step 11 — (Optional) Level-ups

### A. Instant builds with a GitHub webhook instead of polling
1. Install ngrok, then run `ngrok http 8081` and copy the `https://….ngrok-free.app` URL.
2. GitHub repo → **Settings → Webhooks → Add webhook**
   - Payload URL: `https://<ngrok-url>/github-webhook/`
   - Content type: `application/json`, event: **Just the push event**
3. Jenkins job → Triggers: ✅ **GitHub hook trigger for GITScm polling**. You can now remove Poll SCM.

### B. Reach the app without port-forward (Ingress)
kind only exposes ports that were mapped **when the cluster was created**. Check yours:

```powershell
docker port <your-cluster-name>-control-plane
```

If you see `80/tcp` and `443/tcp`, you can install ingress-nginx for kind and add an Ingress. If not, you'd need to recreate the cluster with `extraPortMappings` (`kind-config.yaml` with `containerPort: 80 → hostPort: 80`). Keep using port-forward until then.

### C. Argo CD CLI
```powershell
winget install argoproj.argocd
argocd login localhost:8443 --insecure --username admin
argocd app list
argocd app history node-practice-app
```

---

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| Jenkins: `docker: not found` | You started the plain `jenkins/jenkins` image. Use `jenkins-docker:lts` (Step 5.1) |
| Jenkins: `client version 1.41 is too old` | Same cause: old Docker CLI. Use the image from `jenkins/Dockerfile` |
| Jenkins: `permission denied … docker.sock` | The container must run as root (the provided image does) |
| Jenkins: `denied: requested access to the resource is denied` on push | The Docker Hub username/token in `dockerhub-creds` is wrong, or the image name doesn't match your Docker Hub user |
| Jenkins: push to GitHub `403` | The GitHub token needs **Contents: Read and write** on this repo |
| Jenkins: `No such DSL method 'timestamps'` | Install the **Timestamper** plugin, or delete the `timestamps()` line |
| Builds keep triggering themselves | The manifest commit message must contain `[skip ci]`. Check the Jenkinsfile |
| Pods `ImagePullBackOff` | Tag doesn't exist on Docker Hub, the name is misspelled, or the repo is **private**. Make it public for practice |
| Pods `CrashLoopBackOff` | `kubectl -n practice logs <pod>` to see the Node error |
| Argo CD sync error `provided port is already allocated` | Another Service already uses that NodePort (30080 = Jenkins here). Keep `k8s/service.yaml` as ClusterIP |
| Argo CD `Unknown` / `ComparisonError` | Wrong `repoURL`, or a private repo not added in Settings → Repositories |
| Argo CD `OutOfSync` for a long time | Click **Refresh**. It polls git every ~3 min by default |
| `port-forward` closes | Normal after a rolling update. Run it again |
| kind cluster gone after reboot | Start Docker Desktop. kind node containers restart with it (`docker ps` should show `<name>-control-plane`) |

---

## Clean up

```powershell
kubectl delete -f argocd/application.yaml
kubectl delete namespace practice
docker rm -f jenkins
docker volume rm jenkins_home
```

Deleting the Argo CD Application also deletes the app. Removing the `jenkins_home` volume wipes the Jenkins config.
**Don't delete the `argocd` namespace on `mycluster`.** Your `gps` and `python-app` apps depend on it.
