import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 清理版本号前缀（Tauri v2 updater 要求 SemVer 不带前导 `v`）
 */
export function normalizeSemverVersion(rawVersion) {
  return String(rawVersion || '')
    .trim()
    .replace(/^v/i, '');
}

/**
 * 识别更新包对应的 Tauri v2 平台键名列表
 */
export function classifyAssetPlatformKeys(assetName) {
  const lower = String(assetName || '').toLowerCase();
  if (!lower || lower.endsWith('.sig')) return [];

  // Windows NSIS 安装包
  if (
    lower.endsWith('.exe') &&
    !lower.includes('arm64') &&
    !lower.includes('aarch64')
  ) {
    return ['windows-x86_64', 'windows-x86_64-nsis'];
  }

  // macOS Apple Silicon (.app.tar.gz / .tar.gz)
  if (
    lower.endsWith('.tar.gz') &&
    !lower.includes('linux') &&
    (lower.includes('aarch64') || lower.includes('arm64'))
  ) {
    return ['darwin-aarch64'];
  }

  // macOS Intel x64 (.app.tar.gz / .tar.gz)
  if (
    lower.endsWith('.tar.gz') &&
    !lower.includes('linux') &&
    !lower.includes('aarch64') &&
    !lower.includes('arm64') &&
    (lower.includes('macos') ||
      lower.includes('darwin') ||
      lower.includes('.app.tar.gz') ||
      lower.includes('x64') ||
      lower.includes('x86_64'))
  ) {
    return ['darwin-x86_64'];
  }

  // Linux x64 DEB
  if (
    lower.endsWith('.deb') &&
    !lower.includes('arm64') &&
    !lower.includes('aarch64')
  ) {
    return ['linux-x86_64', 'linux-x86_64-deb'];
  }

  return [];
}

/**
 * 根据 GitHub Release 资产元信息与对应的 .sig 内容构造标准 Tauri v2 latest.json 清单
 */
export function buildUpdaterManifest({
  version,
  notes = '',
  pubDate = new Date().toISOString(),
  assets = [],
  readSignature,
}) {
  const normalizedVersion = normalizeSemverVersion(version);
  if (!normalizedVersion) {
    throw new Error('Missing release version for updater manifest');
  }

  const assetNames = new Set(assets.map((a) => a?.name).filter(Boolean));
  const platforms = {};

  for (const asset of assets) {
    if (!asset?.name || !asset?.url) continue;
    const platformKeys = classifyAssetPlatformKeys(asset.name);
    if (platformKeys.length === 0) continue;

    const sigName = `${asset.name}.sig`;
    if (!assetNames.has(sigName)) {
      console.warn(`[updater-manifest] Skipping ${asset.name}: missing signature asset ${sigName}`);
      continue;
    }

    const rawSig = typeof readSignature === 'function' ? readSignature(sigName) : '';
    const signature = String(rawSig || '').trim();
    if (!signature) {
      console.warn(`[updater-manifest] Skipping ${asset.name}: empty signature content in ${sigName}`);
      continue;
    }

    for (const key of platformKeys) {
      platforms[key] = {
        signature,
        url: asset.url,
      };
    }
  }

  return {
    version: normalizedVersion,
    notes: String(notes || '').trim(),
    pub_date: pubDate,
    platforms,
  };
}

function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2);
      opts[key] = argv[++i];
    }
  }
  return opts;
}

function runCli() {
  const opts = parseCliArgs(process.argv.slice(2));
  const assetsJsonPath = opts['assets-json'];
  const sigDir = opts['sig-dir'];
  const version = opts['version'];
  const notesFile = opts['notes-file'];
  const outputPath = opts['output'] || 'latest.json';

  if (!assetsJsonPath || !sigDir || !version) {
    console.error(
      'Usage: node scripts/generate-updater-manifest.mjs --assets-json <path> --sig-dir <dir> --version <semver> [--notes-file <path>] [--output <path>]'
    );
    process.exit(1);
  }

  const rawAssetsJson = JSON.parse(fs.readFileSync(assetsJsonPath, 'utf8'));
  const rawAssets = Array.isArray(rawAssetsJson) ? rawAssetsJson : rawAssetsJson.assets || [];
  const assets = rawAssets.map((a) => ({
    name: a.name,
    url: a.url || a.browser_download_url,
  }));

  const notes =
    notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : '';

  const manifest = buildUpdaterManifest({
    version,
    notes,
    assets,
    readSignature: (sigName) => {
      const fullPath = path.join(sigDir, sigName);
      if (!fs.existsSync(fullPath)) return '';
      return fs.readFileSync(fullPath, 'utf8');
    },
  });

  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    `[updater-manifest] Generated ${outputPath} for version ${manifest.version} with platforms: ${Object.keys(manifest.platforms).join(', ') || '(none)'}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}
