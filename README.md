# OmniPlay 官网

产品介绍与下载入口,托管在 Cloudflare Pages,域名 `omni.plat-service.com`。

## 架构

```
构建时(CI / 本地)                    运行时(用户浏览器)
─────────────────────                ─────────────────────
fetch-releases.mjs                   index.html
  │ 拉 GitHub Releases                  │ fetch('releases.json')
  │ 自动识别平台(macOS/Android/…)        │ 渲染下载按钮
  │ 过滤非 github.com 的资产             │
  ▼                                    ▼
dist/releases.json  ────────静态──→   Cloudflare 边缘
```

**关键点:浏览器从不请求 `api.github.com`。** 国内用户打开页面时,只从
Cloudflare 边缘取一个静态 JSON,绕开了 GitHub API 在国内不可达的问题。

## 目录

```
index.html          页面结构与文案
assets/styles.css   样式(深色为主,跟随系统切浅色)
assets/main.js      下载区渲染(XSS 安全:文本走 textContent,URL 校验 https + github.com)
scripts/build.mjs   零依赖构建 → dist/
scripts/fetch-releases.mjs   拉 Release → dist/releases.json
scripts/serve.mjs   本地预览服务器
scripts/test-fetch-releases.mjs   26 项集成测试
_headers            Cloudflare 响应头与缓存策略
.github/workflows/deploy.yml    push 自动部署
```

## 本地开发

```bash
npm run build     # 构建到 dist/
npm run serve     # http://localhost:4321
npm test          # 跑测试
```

构建时如果设置了 `GITHUB_TOKEN`,会带上它拉 Release,避开匿名调用的速率限制:

```bash
GITHUB_TOKEN="$(gh auth token)" npm run build
```

## 自动部署

推送到 `main` 会自动触发 `.github/workflows/deploy.yml`,完成
测试 → 构建 → 部署到 Cloudflare Pages。仓库需要两个 secret:

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 需要 Pages 编辑权限 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |

### OmniPlay 发新版本后同步站点

站点版本信息来自 `omniplay` 仓库的 Releases。发版后有三种同步方式:

1. **手动**(最省事):进本仓库 Actions,点 *Run workflow*。
2. **自动**:在 `omniplay` 仓库加一个 workflow,发版时调本仓库的
   `repository_dispatch`(需给本仓库的 `GITHUB_TOKEN` 加 `contents: write`)。
3. **Cloudflare Deploy Hook**:在 Pages 项目里建 deploy hook,
   配合上面第 2 种方式或任何外部系统直接 curl。

`dist/releases.json` 的缓存策略是 `max-age=300`,所以即使不重建,
5 分钟内也会拿到新版本号。

## 构建脚本的降级行为

`fetch-releases.mjs` 永远会产出合法 JSON,不会让构建失败:

| 情况 | `status` | 页面表现 |
|---|---|---|
| 正常 | `ok` | 显示版本号与各平台下载按钮 |
| 仓库无 Release | `empty` | "首个版本即将发布" |
| API 404 / 403 / 网络失败 | `error` | "暂时读不到版本信息" |

只有 `github.com/.../releases/download/` 开头的资产会被收进页面,
防止把外部 URL 当成下载链接。
