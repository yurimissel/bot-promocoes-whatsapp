const http = require('http');

const port = Number.parseInt(process.env.PORT || '3000', 10);

const request = http.get({
  hostname: '127.0.0.1',
  port,
  path: '/api/health',
  timeout: 4000,
}, (response) => {
  response.resume();
  process.exit(response.statusCode === 200 ? 0 : 1);
});

request.on('timeout', () => request.destroy(new Error('Health check timeout')));
request.on('error', () => process.exit(1));
