#!/usr/bin/env node
/**
 * fetch-releases 的集成测试。
 *
 * 起一个本地 mock GitHub API,喂各种形状的响应,校验脚本产出的
 * releases.json 是否正确 —— 平台识别、预发布跳过、恶意 URL 拦截、
 * 各种错误状态降级。
 *
 * 跑法:node scripts/test-fetch-releases.mjs
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'dist/releases.json');
const SCRIPT = resolve(ROOT, 'scripts/fetch-releases.mjs');

const dl = (repo, tag, name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

/**
 * 起一个 mock API,跑一次构建脚本,返回产出的 JSON。
 *
 * 必须用异步 spawn:spawnSync 会阻塞本进程事件循环,
 * 同进程内的 mock server 永远无法响应,子进程只能等到超时。
 */
function run(payload, { status = 200 } = {}) {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const child = spawn(process.execPath, [SCRIPT], {
        env: {
          ...process.env,
          OMNIPLAY_API_BASE: `http://127.0.0.1:${port}`,
          OMNIPLAY_REPO: 'test/omni',
          GITHUB_TOKEN: '',
        },
        stdio: 'ignore',
      });
      child.on('close', async () => {
        server.close(async () => {
          const json = JSON.parse(await readFile(OUT, 'utf8'));
          resolvePromise(json);
        });
      });
    });
  });
}

// ── 用例 1:正常发布,多平台资产 ──────────────────────
console.log('\n[用例 1] 正常发布,macOS + Android 资产');
{
  const data = await run([
    {
      draft: false,
      prerelease: false,
      tag_name: 'v0.3.1',
      name: 'OmniPlay v0.3.1',
      html_url: 'https://github.com/test/omni/releases/tag/v0.3.1',
      published_at: '2026-10-01T12:00:00Z',
      body: '## 更新内容\n- 修复投播断流',
      assets: [
        { name: 'OmniPlay-macOS-arm64.dmg', browser_download_url: dl('test/omni', 'v0.3.1', 'OmniPlay-macOS-arm64.dmg'), size: 88 * 1048576, download_count: 42 },
        { name: 'OmniPlay-macOS-x64.dmg', browser_download_url: dl('test/omni', 'v0.3.1', 'OmniPlay-macOS-x64.dmg'), size: 91 * 1048576, download_count: 18 },
        { name: 'omniplay-v0.3.1.apk', browser_download_url: dl('test/omni', 'v0.3.1', 'omniplay-v0.3.1.apk'), size: 31 * 1048576, download_count: 77 },
        { name: 'OmniPlay-Windows-x64.exe', browser_download_url: dl('test/omni', 'v0.3.1', 'OmniPlay-Windows-x64.exe'), size: 76 * 1048576, download_count: 5 },
        // 外部链接,应被过滤掉
        { name: 'malware.exe', browser_download_url: 'https://evil.example.com/malware.exe', size: 1, download_count: 0 },
      ],
    },
  ]);

  check('status 为 ok', data.status === 'ok', JSON.stringify(data.status));
  check('版本号正确', data.release?.tag === 'v0.3.1');
  check('识别出 macos 平台', !!data.platforms?.macos, Object.keys(data.platforms || {}).join(','));
  check('识别出 android 平台', !!data.platforms?.android);
  check('识别出 windows 平台', !!data.platforms?.windows);
  check('外部 URL 资产被剔除', (data.assets || []).every((a) => !a.name.includes('malware')));
  check('assetCount 只计安全资产 = 4', data.release?.assetCount === 4, String(data.release?.assetCount));
  check('macos 主按钮取体积最大的包',
    data.platforms.macos?.primary?.name === 'OmniPlay-macOS-x64.dmg',
    data.platforms.macos?.primary?.name);
  check('体积换算正确', data.platforms.android?.primary?.sizeText === '31 MB', data.platforms.android?.primary?.sizeText);
  check('macos arch 识别正确', data.platforms.macos?.primary?.arch === 'x64', data.platforms.macos?.primary?.arch);
  // 回归:架构词不能被当成平台词,否则 "Windows-x64" 会被误判成 macOS
  check('Windows-x64 未被误判为 macos',
    !data.platforms.macos?.assets?.some((a) => a.name.includes('Windows')),
    data.platforms.macos?.assets?.map((a) => a.name).join(','));
  check('windows arch 按自身平台识别',
    data.platforms.windows?.primary?.arch === 'x64', data.platforms.windows?.primary?.arch);
  check('windows 只有一个包时主按钮即它',
    data.platforms.windows?.primary?.name === 'OmniPlay-Windows-x64.exe');
}

// ── 用例 2:无发布 ───────────────────────────────────
console.log('\n[用例 2] 仓库无任何发布');
{
  const data = await run([]);
  check('status 为 empty', data.status === 'empty', data.status);
  check('release 为 null', data.release === null);
}

// ── 用例 3:预发布跳过,取稳定版 ──────────────────────
console.log('\n[用例 3] 预发布存在时应选稳定版');
{
  const data = await run([
    { draft: false, prerelease: true, tag_name: 'v0.4.0-beta1', name: 'beta', html_url: 'https://github.com/test/omni/releases/tag/v0.4.0-beta1', published_at: '2026-10-05T00:00:00Z', body: '', assets: [] },
    { draft: false, prerelease: false, tag_name: 'v0.3.1', name: 'stable', html_url: 'https://github.com/test/omni/releases/tag/v0.3.1', published_at: '2026-10-01T00:00:00Z', body: '', assets: [] },
  ]);
  check('选中稳定版 v0.3.1', data.release?.tag === 'v0.3.1', data.release?.tag);
  check('未标记为预发布', data.release?.isPrerelease === false);
}

// ── 用例 4:只有预发布时也应采用 ──────────────────────
console.log('\n[用例 4] 只有预发布版本');
{
  const data = await run([
    { draft: false, prerelease: true, tag_name: 'v0.4.0-beta1', name: 'beta', html_url: 'https://github.com/test/omni/releases/tag/v0.4.0-beta1', published_at: '2026-10-05T00:00:00Z', body: '', assets: [] },
  ]);
  check('回退到预发布版本', data.release?.tag === 'v0.4.0-beta1', data.release?.tag);
  check('isPrerelease 标记为 true', data.release?.isPrerelease === true);
}

// ── 用例 5:草稿不参与 ───────────────────────────────
console.log('\n[用例 5] 草稿版本应被忽略');
{
  const data = await run([
    { draft: true, prerelease: false, tag_name: 'v9.9.9', name: 'draft', html_url: 'https://github.com/test/omni/releases/tag/v9.9.9', published_at: '2026-10-06T00:00:00Z', body: '', assets: [] },
  ]);
  check('草稿被忽略,状态为 empty', data.status === 'empty', data.status);
}

// ── 用例 6:仓库不存在 ───────────────────────────────
console.log('\n[用例 6] HTTP 404');
{
  const data = await run({ message: 'Not Found' }, { status: 404 });
  check('status 为 error', data.status === 'error', data.status);
  check('带有可读 message', typeof data.message === 'string' && data.message.length > 0);
}

// ── 用例 7:速率限制 ─────────────────────────────────
console.log('\n[用例 7] HTTP 403 速率限制');
{
  const data = await run({ message: 'rate limit exceeded' }, { status: 403 });
  check('status 为 error', data.status === 'error', data.status);
  check('提示速率限制', /速率/.test(data.message || ''), data.message);
}

// ── 用例 8:API 不通 ─────────────────────────────────
console.log('\n[用例 8] 网络不可达');
{
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, OMNIPLAY_API_BASE: 'http://127.0.0.1:1', GITHUB_TOKEN: '' },
    encoding: 'utf8',
  });
  const data = JSON.parse(await readFile(OUT, 'utf8'));
  check('脚本未崩溃退出', r.status === 0, `exit=${r.status}`);
  check('降级为 error 状态', data.status === 'error', data.status);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
