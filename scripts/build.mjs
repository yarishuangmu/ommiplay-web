#!/usr/bin/env node
/**
 * 零依赖构建:拉 Release → 组装 dist/。
 * Cloudflare Pages 的 build 命令直接跑这个文件,不需要 npm install。
 */
import { cp, mkdir, rm, readdir, stat, writeFile, chmod, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

async function main() {
  console.log('[build] 清理 dist/');
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // 1) 拉 Release 信息 → dist/releases.json
  const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/fetch-releases.mjs')], {
    stdio: 'inherit',
  });

  // 2) 静态文件
  console.log('[build] 复制静态资源');
  await copyFile(resolve(ROOT, 'index.html'), resolve(DIST, 'index.html'));
  await cp(resolve(ROOT, 'assets'), resolve(DIST, 'assets'), { recursive: true });
  await copyFile(resolve(ROOT, '_headers'), resolve(DIST, '_headers'));

  // 3) 404
  await writeFile(
    resolve(DIST, '404.html'),
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>404 — OmniPlay</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d14;
color:#e9ebf2;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
text-align:center;padding:24px}h1{font-size:56px;margin:0 0 8px;letter-spacing:-.03em;
background:linear-gradient(120deg,#6366f1,#8b5cf6);-webkit-background-clip:text;background-clip:text;
color:transparent}p{color:#99a2b8;margin:0 0 24px;font-size:15px}
a{display:inline-block;padding:11px 22px;border-radius:11px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
color:#fff;text-decoration:none;font-size:15px;font-weight:570}
@media(prefers-color-scheme:light){body{background:#fff;color:#141824}p{color:#5a6274}}</style>
</head><body><div><h1>404</h1><p>这个页面不存在。</p><a href="/">回到首页</a></div></body></html>\n`,
    'utf8'
  );

  // 4) 清单
  console.log('[build] 产物清单');
  const walk = async (dir, base = '') => {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await walk(p, rel)));
      else out.push(`${rel}  (${(await stat(p)).size} B)`);
    }
    return out;
  };
  for (const line of await walk(DIST)) console.log('   ', line);

  console.log('[build] 完成 →', DIST);
  // Release 拉取失败时不算构建失败:页面有降级态
  void r;
}

main().catch((e) => {
  console.error('[build] 失败:', e);
  process.exit(1);
});
