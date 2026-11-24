import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 去除文本中的 HTML 注释（例如 GitHub 自动生成日志末尾/头部附带的 <!-- ... -->）并整理空行。
 */
export function stripHtmlComments(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 去掉前导 v/V，得到纯 SemVer 字符串。
 */
export function normalizeVersionTag(raw) {
  return String(raw || '')
    .trim()
    .replace(/^v/i, '');
}

function parseSemverParts(raw) {
  const m = String(raw || '')
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || '',
  };
}

function comparePrereleaseDesc(aPre, bPre) {
  if (!aPre && !bPre) return 0;
  if (!aPre) return -1;
  if (!bPre) return 1;

  const aSegs = aPre.split('.');
  const bSegs = bPre.split('.');
  const maxLen = Math.max(aSegs.length, bSegs.length);
  for (let i = 0; i < maxLen; i++) {
    if (aSegs[i] === undefined) return 1;
    if (bSegs[i] === undefined) return -1;
    const aNum = /^\d+$/.test(aSegs[i]) ? Number(aSegs[i]) : null;
    const bNum = /^\d+$/.test(bSegs[i]) ? Number(bSegs[i]) : null;
    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return bNum - aNum;
    } else if (aSegs[i] !== bSegs[i]) {
      return bSegs[i].localeCompare(aSegs[i]);
    }
  }
  return 0;
}

/**
 * 语义化版本号降序比较器（正式版高于同基底预发布版）。
 */
export function compareSemverDesc(a, b) {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  if (!pa && !pb) return String(b).localeCompare(String(a));
  if (!pa) return 1;
  if (!pb) return -1;

  if (pb.major !== pa.major) return pb.major - pa.major;
  if (pb.minor !== pa.minor) return pb.minor - pa.minor;
  if (pb.patch !== pa.patch) return pb.patch - pa.patch;
  return comparePrereleaseDesc(pa.prerelease, pb.prerelease);
}

/**
 * 从现有 Git Tag 列表中找出早于 currentTag 的最近前序版本 Tag。
 */
export function resolvePreviousTag(currentTag, allTags = []) {
  const currentNorm = normalizeVersionTag(currentTag).toLowerCase();
  const uniqueTags = Array.from(
    new Set((allTags || []).map((t) => String(t || '').trim()).filter(Boolean))
  ).filter((t) => normalizeVersionTag(t).toLowerCase() !== currentNorm);

  if (uniqueTags.length === 0) return undefined;

  const sorted = [...uniqueTags].sort(compareSemverDesc);
  const olderTag = sorted.find((candidate) => compareSemverDesc(currentTag, candidate) < 0);
  return olderTag || sorted[0];
}

/**
 * 从 CHANGELOG.md 提取指定版本（`## [vX.Y.Z]` 或 `## X.Y.Z`）对应的 Markdown 更新说明。
 */
export function extractChangelogSection(markdown, targetVersion) {
  const targetNorm = normalizeVersionTag(targetVersion).toLowerCase();
  if (!markdown || !targetNorm) return '';

  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const collected = [];
  let capturing = false;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (capturing) break;
      const rawTitle = h2Match[1].trim();
      const verMatch = rawTitle.match(
        /^\[?v?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\s|\]|$|—|–|-|:)/i
      );
      if (verMatch && verMatch[1].toLowerCase() === targetNorm) {
        capturing = true;
      }
      continue;
    }

    if (capturing) {
      collected.push(line);
    }
  }

  if (!capturing) return '';

  // 移除区块末尾紧邻下一版本的空行与纯分隔线
  while (
    collected.length > 0 &&
    (!collected[collected.length - 1].trim() ||
      /^(?:---|\*\*\*|___)\s*$/.test(collected[collected.length - 1]))
  ) {
    collected.pop();
  }

  return stripHtmlComments(collected.join('\n'));
}

const COMMIT_CATEGORY_DEFS = [
  { key: 'feat', title: '### 🚀 新功能' },
  { key: 'fix', title: '### 🐛 问题修复' },
  { key: 'perf', title: '### ⚡ 性能优化' },
  { key: 'refactor', title: '### ♻️ 体验与架构优化' },
  { key: 'highlights', title: '### ✨ 更新内容' },
  { key: 'chore', title: '### 🛠️ 工程与维护' },
  { key: 'other', title: '### 📝 其他变更' },
];

const CONVENTIONAL_TYPE_TO_KEY = {
  feat: 'feat',
  fix: 'fix',
  perf: 'perf',
  refactor: 'refactor',
  style: 'refactor',
  ci: 'chore',
  build: 'chore',
  docs: 'chore',
  chore: 'chore',
  test: 'chore',
};

/**
 * 将直接提交到分支的 git log 解析并分类成中文化更新日志。
 */
export function parseCommitsToMarkdown(commits, options = {}) {
  const buckets = new Map();
  for (const def of COMMIT_CATEGORY_DEFS) {
    buckets.set(def.key, new Set());
  }

  for (const commit of commits || []) {
    const subject = String(commit?.subject || '').trim();
    const body = stripHtmlComments(commit?.body || '');
    if (!subject) continue;

    if (/^Merge\s+(?:branch|pull request|remote-tracking)/i.test(subject)) {
      continue;
    }
    if (/^chore\(updater\):/i.test(subject)) {
      continue;
    }

    // 纯版本号发版提交（如 `release: v0.2.1`）：若有列表正文则提取内容，否则跳过噪声标题
    if (/^(?:release|chore\(release\))(?:\([^)]*\))?:\s*v?\d+\.\d+\.\d+/i.test(subject)) {
      if (body) {
        for (const rawLine of body.split('\n')) {
          const bulletMatch = rawLine.trim().match(/^[-*]\s+(.+)$/);
          if (bulletMatch && bulletMatch[1].trim()) {
            buckets.get('highlights').add(`- ${bulletMatch[1].trim()}`);
          }
        }
      }
      continue;
    }

    const ccMatch = subject.match(
      /^(feat|fix|perf|refactor|style|ci|build|docs|chore|test)(?:\(([^)]+)\))?!?:\s*(.+)$/i
    );
    if (ccMatch) {
      const rawType = ccMatch[1].toLowerCase();
      const scope = (ccMatch[2] || '').trim();
      const message = ccMatch[3].trim();
      if (!message) continue;
      const bucketKey = CONVENTIONAL_TYPE_TO_KEY[rawType] || 'other';
      const entry = scope ? `- **${scope}**: ${message}` : `- ${message}`;
      buckets.get(bucketKey).add(entry);
    } else {
      buckets.get('other').add(`- ${subject}`);
    }
  }

  const sections = [];
  for (const def of COMMIT_CATEGORY_DEFS) {
    const entries = Array.from(buckets.get(def.key) || []);
    if (entries.length > 0) {
      sections.push(`${def.title}\n${entries.join('\n')}`);
    }
  }

  let markdown =
    sections.length > 0
      ? sections.join('\n\n')
      : `Nocta · 夜幕 ${options.currentTag || ''} 版本更新发布。`.trim();

  if (options.includeCompareLink && options.repo && options.prevTag && options.currentTag) {
    markdown += `\n\n**完整变更对比**：https://github.com/${options.repo}/compare/${options.prevTag}...${options.currentTag}`;
  }

  return stripHtmlComments(markdown);
}

/**
 * 构建 GitHub Release 完整说明与客户端内更新摘要：
 * 1. 优先提取 CHANGELOG.md 对应版本精选说明；
 * 2. 未找到时自动汇总 prevTag..tag 期间 git commits 并按类型分类。
 */
export function buildReleaseOutputs({
  tag,
  repo = '',
  changelogText = '',
  commits = [],
  prevTag,
  templateText = '',
}) {
  const fromChangelog = extractChangelogSection(changelogText, tag);
  const updaterNotes = fromChangelog
    ? stripHtmlComments(fromChangelog)
    : parseCommitsToMarkdown(commits, {
        currentTag: tag,
        includeCompareLink: false,
      });

  let releaseNotes = updaterNotes;
  if (repo && prevTag && tag && !releaseNotes.includes('/compare/')) {
    releaseNotes += `\n\n**完整变更对比**：https://github.com/${repo}/compare/${prevTag}...${tag}`;
  }

  const cleanTemplate = String(templateText || '').trim();
  if (cleanTemplate) {
    releaseNotes = `${releaseNotes}\n\n---\n\n${cleanTemplate}`;
  }

  return {
    updaterNotes: stripHtmlComments(updaterNotes),
    releaseNotes: stripHtmlComments(releaseNotes),
  };
}

function readGitTagsSafe() {
  try {
    const out = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function refExistsSafe(ref) {
  if (!ref) return false;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readGitCommitsSafe(prevTag, currentTag) {
  const endRef = refExistsSafe(`refs/tags/${currentTag}`)
    ? `refs/tags/${currentTag}`
    : 'HEAD';
  const rangeArgs =
    prevTag && refExistsSafe(`refs/tags/${prevTag}`)
      ? [`refs/tags/${prevTag}..${endRef}`]
      : [endRef, '-n', '30'];

  try {
    const out = execFileSync(
      'git',
      ['log', ...rangeArgs, '--format=%H%x1f%s%x1f%b%x1e'],
      { encoding: 'utf8' }
    );
    return out
      .split('\x1e')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash = '', subject = '', body = ''] = record.split('\x1f');
        return { hash: hash.trim(), subject: subject.trim(), body: body.trim() };
      });
  } catch {
    return [];
  }
}

function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      opts[arg.slice(2)] = argv[++i];
    }
  }
  return opts;
}

function runCli() {
  const opts = parseCliArgs(process.argv.slice(2));
  const tag = opts.tag || '';
  if (!tag) {
    console.error(
      'Usage: node scripts/generate-release-notes.mjs --tag <vX.Y.Z> [--repo owner/repo] [--changelog CHANGELOG.md] [--template .github/release-template.md] [--prev-tag vX.Y.Z] [--out-release release_notes.md] [--out-updater updater_notes.md]'
    );
    process.exit(1);
  }

  const repo = opts.repo || '';
  const changelogPath = opts.changelog || 'CHANGELOG.md';
  const templatePath = opts.template || '.github/release-template.md';
  const outRelease = opts['out-release'] || 'release_notes.md';
  const outUpdater = opts['out-updater'] || 'updater_notes.md';

  const changelogText = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, 'utf8')
    : '';
  const templateText = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, 'utf8')
    : '';

  const allTags = readGitTagsSafe();
  const prevTag = opts['prev-tag'] || resolvePreviousTag(tag, allTags);
  const commits = readGitCommitsSafe(prevTag, tag);

  const { releaseNotes, updaterNotes } = buildReleaseOutputs({
    tag,
    repo,
    changelogText,
    commits,
    prevTag,
    templateText,
  });

  fs.writeFileSync(outRelease, `${releaseNotes}\n`, 'utf8');
  fs.writeFileSync(outUpdater, `${updaterNotes}\n`, 'utf8');
  console.log(
    `[release-notes] Generated ${outRelease} (${releaseNotes.length} chars) and ${outUpdater} (${updaterNotes.length} chars) for ${tag} (prev: ${prevTag || 'none'})`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}
