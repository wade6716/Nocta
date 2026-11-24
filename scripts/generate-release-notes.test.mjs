import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReleaseOutputs,
  extractChangelogSection,
  parseCommitsToMarkdown,
  resolvePreviousTag,
  stripHtmlComments,
} from './generate-release-notes.mjs';

test('stripHtmlComments removes GitHub generated HTML comments and collapses extra blank lines', () => {
  const input =
    '<!-- Release notes generated using configuration in .github/release.yml at v0.2.1 -->\n\n\n### 🚀 新功能\n- 支持弹幕自动搜索<!-- inline comment -->\n';
  assert.equal(stripHtmlComments(input), '### 🚀 新功能\n- 支持弹幕自动搜索');
});

test('extractChangelogSection extracts matching version section regardless of v prefix or date suffix', () => {
  const changelog = `# 更新日志

## [v0.2.1] - 2026-11-24

### 🐛 问题修复
- 修复自动更新清单漏生成问题

---

## 0.2.0 — 2026-11-24

### 🚀 新功能
- 支持新剧两阶段弹幕自动匹配

## [v0.1.0] - 2026-11-23
- 首个正式版本
`;

  assert.equal(
    extractChangelogSection(changelog, 'v0.2.1'),
    '### 🐛 问题修复\n- 修复自动更新清单漏生成问题'
  );
  assert.equal(
    extractChangelogSection(changelog, 'v0.2.0'),
    '### 🚀 新功能\n- 支持新剧两阶段弹幕自动匹配'
  );
  assert.equal(extractChangelogSection(changelog, 'v0.9.9'), '');
});

test('resolvePreviousTag selects nearest older semver tag including stable over prerelease', () => {
  const tags = ['v0.1.0-alpha.14', 'v0.1.0-alpha.15', 'v0.1.0', 'v0.2.0', 'v0.2.1'];
  assert.equal(resolvePreviousTag('v0.2.1', tags), 'v0.2.0');
  assert.equal(resolvePreviousTag('v0.2.0', tags), 'v0.1.0');
  assert.equal(resolvePreviousTag('v0.1.0', tags), 'v0.1.0-alpha.15');
  assert.equal(resolvePreviousTag('v0.2.2', tags), 'v0.2.1');
});

test('parseCommitsToMarkdown groups Conventional Commits, skips release/merge noise, and extracts release bullets', () => {
  const commits = [
    { subject: 'Merge branch main of github.com:wade6716/Nocta' },
    { subject: 'chore(updater): publish manifest for v0.2.0' },
    { subject: 'release: v0.2.1', body: '' },
    {
      subject: 'release: v0.2.0',
      body: '- 新剧起播支持两阶段自动搜番匹配\n- 多版本片源默认择优最高画质',
    },
    { subject: 'feat(player): 支持耳机摘下自动暂停播放' },
    { subject: 'fix(search): 修复同剧单集重复刷屏' },
    { subject: 'perf(nav): 一级页面 Keep-Alive 零卸载切换' },
    { subject: 'ci: 修复 release.yml 传递跳过问题' },
  ];

  const md = parseCommitsToMarkdown(commits, {
    repo: 'wade6716/Nocta',
    prevTag: 'v0.2.0',
    currentTag: 'v0.2.1',
    includeCompareLink: true,
  });

  assert.match(md, /### 🚀 新功能\n- \*\*player\*\*: 支持耳机摘下自动暂停播放/);
  assert.match(md, /### 🐛 问题修复\n- \*\*search\*\*: 修复同剧单集重复刷屏/);
  assert.match(md, /### ⚡ 性能优化\n- \*\*nav\*\*: 一级页面 Keep-Alive 零卸载切换/);
  assert.match(md, /### ✨ 更新内容\n- 新剧起播支持两阶段自动搜番匹配/);
  assert.match(md, /### 🛠️ 工程与维护\n- 修复 release\.yml 传递跳过问题/);
  assert.doesNotMatch(md, /Merge branch/);
  assert.doesNotMatch(md, /publish manifest/);
  assert.match(
    md,
    /\*\*完整变更对比\*\*：https:\/\/github\.com\/wade6716\/Nocta\/compare\/v0\.2\.0\.\.\.v0\.2\.1/
  );
});

test('parseCommitsToMarkdown provides fallback notice when no effective commits remain', () => {
  const md = parseCommitsToMarkdown([{ subject: 'release: v0.2.1' }], {
    currentTag: 'v0.2.1',
  });
  assert.equal(md, 'Nocta · 夜幕 v0.2.1 版本更新发布。');
});

test('buildReleaseOutputs prioritizes CHANGELOG.md over git log and keeps updaterNotes concise without template', () => {
  const changelog = `## [v0.2.2] - 2026-11-25
### 🚀 新功能
- 精选中文更新描述
`;
  const template = '## 📦 资产下载与系统支持\n| Windows | setup.exe |';

  const curated = buildReleaseOutputs({
    tag: 'v0.2.2',
    repo: 'wade6716/Nocta',
    prevTag: 'v0.2.1',
    changelogText: changelog,
    commits: [{ subject: 'feat: raw commit text that should be overridden' }],
    templateText: template,
  });

  assert.equal(curated.updaterNotes, '### 🚀 新功能\n- 精选中文更新描述');
  assert.doesNotMatch(curated.updaterNotes, /资产下载/);
  assert.match(curated.releaseNotes, /精选中文更新描述/);
  assert.match(curated.releaseNotes, /资产下载与系统支持/);
  assert.match(curated.releaseNotes, /compare\/v0\.2\.1\.\.\.v0\.2\.2/);

  const fallback = buildReleaseOutputs({
    tag: 'v0.2.3',
    repo: 'wade6716/Nocta',
    prevTag: 'v0.2.2',
    changelogText: changelog,
    commits: [{ subject: 'fix(player): 修复进度条圆点错位' }],
    templateText: template,
  });

  assert.equal(fallback.updaterNotes, '### 🐛 问题修复\n- **player**: 修复进度条圆点错位');
  assert.match(fallback.releaseNotes, /修复进度条圆点错位/);
  assert.match(fallback.releaseNotes, /资产下载与系统支持/);
});
