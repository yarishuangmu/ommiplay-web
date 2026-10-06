#!/usr/bin/env node
/** 本地预览用的零依赖静态服务器:npm run serve */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 4321;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // 归一化并阻断目录穿越
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel.endsWith('/')) rel += 'index.html';

    let file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    let s = await stat(file).catch(() => null);
    if (s?.isDirectory()) {
      file = join(file, 'index.html');
      s = await stat(file).catch(() => null);
    }
    if (!s) {
      // SPA 风格回退:找不到就回 404.html(线上由 Pages 接管)
      const notFound = await readFile(join(ROOT, '404.html')).catch(() => '404');
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(notFound);
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body);
  } catch (e) {
    res.writeHead(500).end(String(e?.message || e));
  }
}).listen(PORT, () => {
  console.log(`预览地址  http://localhost:${PORT}`);
  console.log(`静态根目录 ${ROOT}`);
});
