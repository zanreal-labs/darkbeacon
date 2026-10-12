// Round-robin proxy in front of replicas, for the two-replica load run: plain HTTP requests and
// WebSocket upgrades alike, no stickiness. Runs inside the loadtest image:
//   node proxy.mjs http://app1:3000 http://app2:3000
import { request, createServer } from 'node:http';
import { connect } from 'node:net';

const targets = process.argv.slice(2).map((t) => new URL(t));
if (targets.length === 0) throw new Error('usage: node proxy.mjs <target> [<target> ...]');
let next = 0;
const pick = () => targets[next++ % targets.length];
const counts = new Map(targets.map((t) => [t.host, 0]));

const server = createServer((req, res) => {
  const target = pick();
  counts.set(target.host, counts.get(target.host) + 1);
  const upstream = request(
    { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

server.on('upgrade', (req, socket, head) => {
  const target = pick();
  counts.set(target.host, counts.get(target.host) + 1);
  const upstream = connect(Number(target.port), target.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
});

server.listen(3000, () => console.log(`proxy on :3000 -> ${targets.map((t) => t.host).join(', ')}`));
setInterval(() => console.log(`routed ${JSON.stringify(Object.fromEntries(counts))}`), 30_000).unref();
