import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3010);
const SERVICE = process.env.OTEL_SERVICE_NAME ?? 'example-http';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.url?.startsWith('/hello')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const name = url.searchParams.get('name') ?? 'world';
    const payload = {
      hello: name,
      service: SERVICE,
      ts: Date.now(),
    };
    process.stdout.write(JSON.stringify({
      severity: 'INFO',
      service: SERVICE,
      msg: 'hello-request',
      name,
      ts: payload.ts,
    }) + '\n');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', path: req.url }));
});

server.listen(PORT, () => {
  process.stdout.write(`example-http listening on http://localhost:${PORT}\n`);
});
