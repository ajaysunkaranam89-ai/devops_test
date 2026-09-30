const STAGES = [
  {
    icon: '💻', name: 'Code', tool: 'VS Code + Git',
    what: 'You change the app on your laptop, run it and its tests locally, then commit.',
    file: 'src/, test/',
    cmd: 'npm install\nnpm test\nnpm start\ngit add . && git commit -m "change title"',
  },
  {
    icon: '🐙', name: 'Source', tool: 'GitHub',
    what: 'git push sends the commit to GitHub. A webhook notifies Jenkins that there is new code.',
    file: '.git (remote: origin)',
    cmd: 'git push origin main\n# GitHub → Settings → Webhooks → http://<jenkins>/github-webhook/',
  },
  {
    icon: '🧪', name: 'Build & Test', tool: 'Jenkins',
    what: 'Jenkins checks out the code and runs the Jenkinsfile. The Docker "test" stage runs npm test, and a failed test stops the pipeline.',
    file: 'Jenkinsfile, Dockerfile (target: test)',
    cmd: 'docker build --target test -t app:test .',
  },
  {
    icon: '🐳', name: 'Package', tool: 'Docker Hub',
    what: 'Jenkins builds the small production image, tags it with the build number, and pushes it to Docker Hub.',
    file: 'Dockerfile (target: prod)',
    cmd: 'docker build --target prod -t <user>/node-practice-app:42 .\ndocker push <user>/node-practice-app:42',
  },
  {
    icon: '📝', name: 'GitOps', tool: 'Jenkins → GitHub',
    what: 'Jenkins updates the image tag in k8s/deployment.yaml and commits it with [skip ci]. Git now records what should be running.',
    file: 'k8s/deployment.yaml',
    cmd: 'sed -i "s|image: .*|image: <user>/node-practice-app:42|" k8s/deployment.yaml\ngit commit -m "Deploy image 42 [skip ci]" && git push',
  },
  {
    icon: '🐙', name: 'Sync', tool: 'Argo CD',
    what: 'Argo CD watches the k8s/ folder. When it sees a new commit, it marks the app OutOfSync, then syncs and applies the change.',
    file: 'argocd/application.yaml',
    cmd: 'kubectl apply -f argocd/application.yaml\nargocd app get node-practice-app',
  },
  {
    icon: '⎈', name: 'Run', tool: 'Kubernetes',
    what: 'The Deployment rolls out new pods one by one. Readiness probes on /health make sure traffic only goes to healthy pods.',
    file: 'k8s/deployment.yaml, k8s/service.yaml',
    cmd: 'kubectl -n practice get pods -w\nkubectl -n practice rollout status deploy/node-practice-app',
  },
];

const CHECKLIST = [
  'Run the app locally with npm start',
  'Build & run the Docker image locally',
  'Create a GitHub repo and push the code',
  'Install Jenkins (Docker) with Docker CLI access',
  'Add dockerhub-creds and github-creds in Jenkins',
  'Create a Pipeline job from the Jenkinsfile',
  'Add a GitHub webhook to trigger Jenkins',
  'Start a local Kubernetes cluster (kind / minikube / Docker Desktop)',
  'Install Argo CD and open its UI',
  'Apply argocd/application.yaml',
  'Change the UI, push, and watch the version update',
  'Roll back using git revert and watch Argo CD sync',
];

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------- Pipeline ----------
function renderPipeline() {
  const el = $('pipeline');
  el.innerHTML = STAGES.map((s, i) => `
    ${i ? `<div class="connector" data-c="${i}"></div>` : ''}
    <div class="stage" data-i="${i}">
      <div class="icon">${s.icon}</div>
      <div class="name">${s.name}</div>
      <div class="tool">${s.tool}</div>
      <div class="state">idle</div>
    </div>`).join('');
  el.querySelectorAll('.stage').forEach((node) =>
    node.addEventListener('click', () => selectStage(Number(node.dataset.i))));
  selectStage(0);
}

function selectStage(i) {
  const s = STAGES[i];
  document.querySelectorAll('.stage').forEach((n) => n.classList.toggle('selected', Number(n.dataset.i) === i));
  $('detail').innerHTML = `
    <h3>${i + 1}. ${s.icon} ${s.name} <span class="muted small">· ${s.tool}</span></h3>
    <div>${s.what}</div>
    <div class="muted small" style="margin-top:8px">Files: <code>${s.file}</code></div>
    <pre>${escapeHtml(s.cmd)}</pre>`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function simulate() {
  const btn = $('runBtn');
  btn.disabled = true;
  const stages = document.querySelectorAll('.stage');
  const connectors = document.querySelectorAll('.connector');
  stages.forEach((n) => { n.classList.remove('running', 'done'); n.querySelector('.state').textContent = 'queued'; });
  connectors.forEach((c) => c.classList.remove('active', 'done'));

  for (let i = 0; i < stages.length; i++) {
    const conn = document.querySelector(`.connector[data-c="${i}"]`);
    if (conn) { conn.classList.add('active'); await sleep(600); conn.classList.replace('active', 'done'); }
    stages[i].classList.add('running');
    stages[i].querySelector('.state').textContent = 'running…';
    selectStage(i);
    await sleep(1100);
    stages[i].classList.replace('running', 'done');
    stages[i].querySelector('.state').textContent = '✓ passed';
  }
  btn.disabled = false;
}

// ---------- Live pod info ----------
function formatUptime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

async function refreshInfo() {
  try {
    const [health, info] = await Promise.all([
      fetch('/health').then((r) => r.json()),
      fetch('/api/info').then((r) => r.json()),
    ]);
    $('healthDot').className = 'dot ' + (health.status === 'ok' ? 'ok' : 'err');
    $('healthText').textContent = health.status === 'ok' ? 'healthy' : 'unhealthy';
    $('versionBadge').textContent = 'build ' + info.version;
    $('hostname').textContent = info.hostname;
    $('version').textContent = info.version;
    $('commit').textContent = info.commit;
    $('node').textContent = info.node;
    $('uptime').textContent = formatUptime(info.uptimeSeconds);
    $('requests').textContent = info.requests;
  } catch {
    $('healthDot').className = 'dot err';
    $('healthText').textContent = 'unreachable';
  }
}

// ---------- Load-balancing demo ----------
async function pingPods() {
  const btn = $('pingBtn');
  btn.disabled = true;
  const counts = {};
  // Parallel requests open several connections, so the Service can route them to different pods
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    fetch(`/api/info?n=${i}-${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { counts[d.hostname] = (counts[d.hostname] || 0) + 1; })
      .catch(() => {})));
  const max = Math.max(...Object.values(counts), 1);
  $('pods').innerHTML = Object.entries(counts).map(([host, n]) => `
    <div class="pod-row">
      <div class="pod-bar"><div style="width:${(n / max) * 100}%"></div><span>${host}</span></div>
      <b>${n}</b>
    </div>`).join('') || '<p class="muted small">No responses.</p>';
  btn.disabled = false;
}

// ---------- Checklist (saved in this browser only) ----------
function loadChecked() {
  try { return JSON.parse(localStorage.getItem('checklist') || '[]'); } catch { return []; }
}
function saveChecked(list) {
  try { localStorage.setItem('checklist', JSON.stringify(list)); } catch { /* ignore */ }
}
function renderChecklist() {
  const checked = loadChecked();
  $('checklist').innerHTML = CHECKLIST.map((item, i) => `
    <li><label><input type="checkbox" data-i="${i}" ${checked.includes(i) ? 'checked' : ''}><span>${i + 1}. ${item}</span></label></li>`).join('');
  $('checklist').querySelectorAll('input').forEach((box) => box.addEventListener('change', () => {
    const list = [...document.querySelectorAll('#checklist input:checked')].map((b) => Number(b.dataset.i));
    saveChecked(list);
    updateProgress(list.length);
  }));
  updateProgress(checked.length);
}
function updateProgress(done) {
  $('progressBar').style.width = `${(done / CHECKLIST.length) * 100}%`;
  $('progressText').textContent = `${done} / ${CHECKLIST.length} done`;
}

renderPipeline();
renderChecklist();
refreshInfo();
setInterval(refreshInfo, 5000);
$('runBtn').addEventListener('click', simulate);
$('pingBtn').addEventListener('click', pingPods);
