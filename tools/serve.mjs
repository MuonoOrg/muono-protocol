// Tiny static server for local checks: node tools/serve.mjs <dir> <port>
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
const dir = resolve(process.argv[2] || 'dist'), port = Number(process.argv[3] || 4173);
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain' };
createServer((q, r) => {
  let p = join(dir, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!p.startsWith(dir) || !existsSync(p)) { r.writeHead(404); return r.end('not found'); }
  r.writeHead(200, { 'content-type': T[extname(p)] || 'application/octet-stream' }); r.end(readFileSync(p));
}).listen(port, () => console.log('serving', dir, 'on', port));
