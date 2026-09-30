const express = require('express');
const os = require('os');
const path = require('path');

const app = express();
app.use(express.json());

// Values injected by Jenkins / the Kubernetes manifest. Defaults are for local runs.
const APP_VERSION = process.env.APP_VERSION || 'dev';
const GIT_COMMIT = process.env.GIT_COMMIT || 'local';
const startedAt = Date.now();
let requestCount = 0;

app.use((req, res, next) => {
  requestCount++;
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Used by Kubernetes liveness/readiness probes
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/info', (req, res) => {
  res.json({
    app: 'node-practice-app',
    version: APP_VERSION,
    commit: GIT_COMMIT,
    hostname: os.hostname(),
    node: process.version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: requestCount,
  });
});

module.exports = app;
