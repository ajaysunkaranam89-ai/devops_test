const app = require('./app');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`node-practice-app listening on port ${PORT}`);
});

// Graceful shutdown so Kubernetes rolling updates don't drop requests
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
