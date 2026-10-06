#!/usr/bin/env node
/**
 * 构建时拉取 GitHub Release,写入 dist/releases.json。
 *
 * 设计要点:浏览器的 releases.json 是纯静态产物,永远不会在运行时请求
 * api.github.com。这样国内用户打开页面时只从 Cloudflare 边缘取一个静态
 * 文件,绕开了 GitHub API 在国内不可达的问题。
 *
 * 任何失败都必须降级为合法 JSON —— 页面要能显示"暂无版本"或"获取失败",
 * 而不是 404。
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'dist/releases.json');

const REPO = process.env.OMNIPLAY_REPO || 'yarishuangmu/ommiplay';
const TOKEN = process.env.GITHUB_TOKEN || '';
// 仅供测试:指向本地 mock 服务
const API_BASE =
  process.env.OMNIPLAY_API_BASE || `https://api.github.com/repos/${REPO}`;

/**
 * 平台识别规则。
 *
 * exts —— 扩展名,优先级最高。
 * keywords —— 平台名关键词。**不要放 x64 / arm64 这类架构词**:
 *   它们只属于 archKeywords,否则 "Windows-x64.exe" 会被先匹配到的
 *   平台规则(若该规则含 x64)误判成别的平台。
 * archKeywords —— 仅用于展示架构,不参与平台归属判定。
 */
const PLATFORMS = [
  {
    id: 'macos',
    label: 'macOS',
    exts: ['.dmg', '.pkg'],
    keywords: ['macos', 'osx', 'darwin', 'mac'],
    archKeywords: ['aarch64', 'arm64', 'apple-silicon', 'silicon', 'universal', 'x86_64', 'x64', 'intel'],
  },
  {
    id: 'android',
    label: 'Android',
    exts: ['.apk'],
    keywords: ['android', 'apk'],
    archKeywords: ['universal', 'arm64-v8a', 'armeabi', 'arm64'],
  },
  {
    id: 'windows',
    label: 'Windows',
    exts: ['.exe', '.msi', '.msix'],
    keywords: ['windows', 'win32', 'win64', 'win-', 'win.'],
    archKeywords: ['x86_64', 'amd64', 'x64', 'x86', 'win32', 'win64'],
  },
  {
    id: 'linux',
    label: 'Linux',
    exts: ['.appimage', '.deb', '.rpm', '.snap'],
    keywords: ['linux', 'ubuntu', 'debian', 'fedora', 'appimage'],
    archKeywords: ['x86_64', 'amd64', 'arm64', 'aarch64'],
  },
];

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

function detectPlatform(assetName) {
  const ext = extOf(assetName);
  const lower = assetName.toLowerCase();
  for (const p of PLATFORMS) {
    if (p.exts.includes(ext)) return p.id;
    if (p.keywords.some((k) => lower.includes(k))) return p.id;
  }
  return 'other';
}

function detectArch(assetName, platformId) {
  const rule = PLATFORMS.find((p) => p.id === platformId);
  if (!rule) return null;
  const lower = assetName.toLowerCase();
  const hit = rule.archKeywords.find((k) => lower.includes(k));
  return hit || null;
}

/** 只放行由 GitHub 托管的 release 资产,避免把外部任意 URL 当下载链接。 */
function isSafeAssetUrl(url) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(url);
}

function mb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function emptyPayload(status, message) {
  return {
    status,
    message: message || null,
    generatedAt: new Date().toISOString(),
    repo: REPO,
    repoUrl: `https://github.com/${REPO}`,
    release: null,
    platforms: {},
  };
}

function pickLatest(list) {
  const usable = list.filter((r) => !r.draft);
  const stable = usable.find((r) => !r.prerelease);
  return stable || usable[0] || null;
}

function buildPayload(release) {
  const assets = (release.assets || [])
    .filter((a) => isSafeAssetUrl(a.browser_download_url))
    .map((a) => {
      const platform = detectPlatform(a.name);
      return {
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
        sizeText: mb(a.size) >= 1 ? `${mb(a.size)} MB` : `${Math.round(a.size / 1024)} KB`,
        downloads: a.download_count,
        platform,
        arch: detectArch(a.name, platform),
      };
    });

  const platforms = {};
  for (const p of PLATFORMS) {
    const list = assets.filter((a) => a.platform === p.id);
    if (!list.length) continue;
    // 体积最大的通常是最完整的通用包,作为主按钮;否则取第一个。
    platforms[p.id] = {
      label: p.label,
      assets: list,
      primary: list.length > 1 ? list.reduce((a, b) => (b.size > a.size ? b : a)) : list[0],
    };
  }

  return {
    status: 'ok',
    message: null,
    generatedAt: new Date().toISOString(),
    repo: REPO,
    repoUrl: `https://github.com/${REPO}`,
    release: {
      tag: release.tag_name,
      name: release.name || release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at,
      isPrerelease: Boolean(release.prerelease),
      notes: release.body || '',
      assetCount: assets.length,
    },
    platforms,
    assets,
  };
}

async function write(json) {
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  console.log(`  ✓ ${OUT}`);
}

async function main() {
  console.log(`[releases] 拉取 ${REPO} …`);
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'omniplay-site-build',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  let res;
  try {
    res = await fetch(`${API_BASE}/releases?per_page=20`, { headers, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    console.warn(`[releases] 网络失败:${err.message} —— 降级为 error 状态`);
    await write(emptyPayload('error', '构建时无法连接 GitHub API'));
    return;
  }

  if (res.status === 404) {
    console.warn('[releases] 仓库不存在或无权限');
    await write(emptyPayload('error', '仓库不存在或令牌无权限'));
    return;
  }
  if (res.status === 403 || res.status === 429) {
    console.warn(`[releases] 触发速率限制 (${res.status}) —— 建议在构建环境配置 GITHUB_TOKEN`);
    await write(emptyPayload('error', 'GitHub API 速率限制'));
    return;
  }
  if (!res.ok) {
    console.warn(`[releases] HTTP ${res.status}`);
    await write(emptyPayload('error', `GitHub API 返回 ${res.status}`));
    return;
  }

  const list = await res.json();
  const latest = pickLatest(list);

  if (!latest) {
    console.log('[releases] 暂无发布版本 —— 页面将显示"即将发布"');
    await write(emptyPayload('empty'));
    return;
  }

  const payload = buildPayload(latest);
  const plats = Object.keys(payload.platforms);
  console.log(`[releases] 最新版本 ${latest.tag_name},资产 ${payload.assets.length} 个,平台 ${plats.join('/') || '未识别'}`);
  await write(payload);
}

main().catch((err) => {
  console.error('[releases] 未捕获异常:', err);
  // 兜底:任何意外都要留下合法 JSON
  return write(emptyPayload('error', String(err?.message || err))).then(() => process.exit(0));
});
