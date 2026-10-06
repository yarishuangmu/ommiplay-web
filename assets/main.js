/**
 * 下载区渲染。
 *
 * 数据源是构建时生成的 releases.json(同源静态文件),
 * 浏览器不会直接请求 api.github.com —— 这是国内可用性的前提。
 *
 * releases.json 里的字段全部来自 GitHub,按不可信输入处理:
 * 所有插入 DOM 的文本走 textContent,URL 先校验协议。
 */
(function () {
  'use strict';

  var metaEl = document.getElementById('dl-meta');
  var btnsEl = document.getElementById('dl-buttons');
  var footEl = document.getElementById('dl-foot');
  if (!metaEl || !btnsEl || !footEl) return;

  var REPO_URL = 'https://github.com/yarishuangmu/ommiplay';
  var RELEASES_URL = REPO_URL + '/releases';

  /** 只放行 https 下载链接,挡掉 javascript: 之类。 */
  function safeUrl(u) {
    if (typeof u !== 'string') return null;
    try {
      var parsed = new URL(u, location.href);
      if (parsed.protocol !== 'https:') return null;
      if (!/^https:\/\/github\.com\//.test(parsed.href)) return null;
      return parsed.href;
    } catch (e) {
      return null;
    }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent,不拼 HTML
    return n;
  }

  function clearAll() {
    metaEl.textContent = '';
    btnsEl.textContent = '';
    footEl.textContent = '';
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function renderEmpty(title, body) {
    clearAll();
    var box = el('div', 'empty-state');
    box.appendChild(el('p', 'empty-state-title', title));
    box.appendChild(el('p', 'empty-state-body', body));
    btnsEl.appendChild(box);
  }

  function renderOk(data) {
    clearAll();

    // ── 版本信息行 ──
    var rel = data.release || {};
    metaEl.appendChild(el('span', 'tag tag-version', rel.tag || '未标记版本'));
    if (rel.isPrerelease) {
      metaEl.appendChild(el('span', 'tag tag-pre', '预发布'));
    }
    var date = formatDate(rel.publishedAt);
    if (date) metaEl.appendChild(el('span', null, '发布于 ' + date));

    // ── 平台下载按钮 ──
    var platforms = data.platforms || {};
    var keys = Object.keys(platforms);
    if (!keys.length) {
      renderEmpty(
        '该版本暂无可下载的安装包',
        'Release 里只有源码压缩包。请到发布页查看详情。'
      );
    } else {
      keys.forEach(function (k) {
        var p = platforms[k];
        if (!p || !p.primary) return;
        var href = safeUrl(p.primary.url);
        if (!href) return;

        var a = el('a', 'dl-btn');
        a.href = href;
        a.rel = 'noopener';
        a.setAttribute('download', '');

        var label = p.label || k;
        if (p.assets && p.assets.length > 1) label += ' · ' + p.assets.length + ' 个包';
        a.appendChild(el('span', 'dl-btn-label', label));

        var subBits = [];
        if (p.primary.sizeText) subBits.push(p.primary.sizeText);
        if (p.primary.arch) subBits.push(p.primary.arch);
        if (p.primary.downloads) subBits.push(p.primary.downloads + ' 次下载');
        a.appendChild(el('span', 'dl-btn-sub', subBits.join(' · ') || '点击下载'));
        btnsEl.appendChild(a);
      });
    }

    // ── 页脚:全部资产 + 发布页 ──
    var all = data.assets || [];
    if (all.length > 1) {
      var more = el('div', 'dl-more');
      more.appendChild(document.createTextNode('全部资产:'));
      all.forEach(function (a) {
        var href = safeUrl(a.url);
        if (!href) return;
        var link = el('a', null, a.name);
        link.href = href;
        link.rel = 'noopener';
        more.appendChild(link);
      });
      footEl.appendChild(more);
      footEl.appendChild(document.createElement('br'));
    }

    var relLink = el('a', null, '查看发布说明 →');
    relLink.href = safeUrl(rel.url) || RELEASES_URL;
    relLink.target = '_blank';
    relLink.rel = 'noopener';
    footEl.appendChild(relLink);
  }

  function render(data) {
    if (!data || typeof data !== 'object') {
      renderEmpty('版本信息不可用', '请到 GitHub 发布页手动下载。');
      return;
    }
    if (data.status === 'ok' && data.release) {
      renderOk(data);
      return;
    }
    if (data.status === 'error') {
      renderEmpty(
        '暂时读不到版本信息',
        '构建时拉取 GitHub 失败。' + (data.message ? '(' + data.message + ')' : '')
      );
      return;
    }
    // status === 'empty'
    renderEmpty(
      '首个版本即将发布',
      '安装包托管在 GitHub Releases,发布后会自动出现在这里。也可以直接到发布页查看。'
    );
  }

  function load() {
    // cache:no-store —— 发布新版本重建后,别让旧 JSON 卡在 CDN 缓存里
    fetch('releases.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(render)
      .catch(function (err) {
        renderEmpty(
          '暂时读不到版本信息',
          '没能加载 releases.json(' + err.message + ')。请到 GitHub 发布页手动下载。'
        );
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
