import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const INDEX_CSS_PATH = path.join(ROOT, 'src', 'index.css');

function walkSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(fullPath));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function escapeCssClassSelector(className) {
  return '.' + className.replace(/[[\]#/:.]/g, '\\$&');
}

test('light-mode bridge avoids dangerous substring [class*="bg-*"] exclusions', () => {
  const css = fs.readFileSync(INDEX_CSS_PATH, 'utf8');
  const bridgeStart = css.indexOf('Light-Mode Glass Token Bridge');
  assert.ok(bridgeStart !== -1, 'Light-Mode Glass Token Bridge section must exist in src/index.css');
  const bridgeCss = css.slice(bridgeStart);

  assert.equal(
    /\[class\*=["']bg-/.test(bridgeCss),
    false,
    'Light-mode bridge must not use [class*="bg-..."] substring matching, which hides white text inside translucent cards'
  );
});

test('light-mode bridge narrows .fixed.inset-0 scrim rule to explicit dark backdrop classes', () => {
  const css = fs.readFileSync(INDEX_CSS_PATH, 'utf8');
  assert.equal(
    /\.nocta-theme-scope\s*:where\(\.fixed\.inset-0\)/.test(css),
    false,
    'Bare .fixed.inset-0 scrim rule must not match non-backdrop fixed elements'
  );
  assert.match(
    css,
    /\.fixed\.inset-0\.bg-black\\\/75/,
    'Explicit dark modal scrim classes like .fixed.inset-0.bg-black/75 must be mapped'
  );
});

test('light-mode bridge keeps base .bg-white/10 specificity low enough for peer-checked states', () => {
  const css = fs.readFileSync(INDEX_CSS_PATH, 'utf8');
  assert.match(
    css,
    /html\.light\s+:where\(\.nocta-theme-scope\)\s+:where\([^)]*\.bg-white\\\/10[^)]*\):where\(:not\(\.preserve-dark\):not\(\.preserve-dark \*\)\)/,
    'Base .bg-white/10 override must use :where(.nocta-theme-scope) and :where(:not(...)) so peer-checked:bg-primary wins'
  );
});

test('all non-player bare dark hex backgrounds are mapped in src/index.css light-mode bridge', () => {
  const css = fs.readFileSync(INDEX_CSS_PATH, 'utf8');
  const bridgeStart = css.indexOf('Light-Mode Glass Token Bridge');
  const bridgeCss = css.slice(bridgeStart);

  const excludedFiles = new Set([
    path.join(ROOT, 'src', 'pages', 'PlayerPage.tsx'),
    path.join(ROOT, 'src', 'pages', 'OsdOverlayPage.tsx'),
    path.join(ROOT, 'src', 'components', 'music', 'NowPlayingOverlay.tsx'),
    path.join(ROOT, 'src', 'components', 'media', 'HeroCarousel.tsx'),
  ]);

  // Intentional dark-only surfaces (light ink accent #1D1D1F or elements inside .preserve-dark)
  const allowedIntentional = new Map([
    ['bg-[#1D1D1F]', new Set(['src/components/layout/ServerSwitcherDropdown.tsx', 'src/pages/SettingsPage.tsx'])],
    ['bg-[#1D1D1F]/10', new Set(['src/pages/DetailPage.tsx'])],
    ['bg-[#0A0A0C]', new Set(['src/pages/DetailPage.tsx'])],
    ['bg-[#1C1C1E]', new Set(['src/pages/DetailPage.tsx'])],
    ['bg-[#1C1C1E]/95', new Set(['src/pages/SettingsPage.tsx'])],
    ['bg-[#181E30]', new Set(['src/pages/music/MusicHomePage.tsx'])],
  ]);

  const files = walkSourceFiles(path.join(ROOT, 'src')).filter((file) => {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (rel.startsWith('src/components/player/')) return false;
    return !excludedFiles.has(file);
  });

  const unmapped = [];
  const darkBgRe = /(?<![a-zA-Z0-9:-])bg-\[#[012][0-9a-fA-F]{5}\](?:\/[\d.\[\]]+)?/g;

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      for (const match of line.matchAll(darkBgRe)) {
        const cls = match[0];
        if (allowedIntentional.get(cls)?.has(rel)) continue;
        const escaped = escapeCssClassSelector(cls);
        if (!bridgeCss.includes(escaped)) {
          unmapped.push(`${rel}:${idx + 1} (${cls})`);
        }
      }
    });
  }

  assert.deepEqual(
    unmapped,
    [],
    `Found bare dark hex backgrounds missing from light-mode bridge in src/index.css:\n${unmapped.join('\n')}`
  );
});
