import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUpdaterManifest,
  classifyAssetPlatformKeys,
  normalizeSemverVersion,
} from './generate-updater-manifest.mjs';

test('normalizeSemverVersion strips leading v prefix', () => {
  assert.equal(normalizeSemverVersion('v0.1.0-alpha.13'), '0.1.0-alpha.13');
  assert.equal(normalizeSemverVersion('V1.2.0'), '1.2.0');
  assert.equal(normalizeSemverVersion('0.1.0-alpha.13'), '0.1.0-alpha.13');
});

test('classifyAssetPlatformKeys maps all 4 desktop release targets cleanly', () => {
  assert.deepEqual(
    classifyAssetPlatformKeys('Nocta_0.1.0-alpha.13_windows_x64-setup.exe'),
    ['windows-x86_64', 'windows-x86_64-nsis']
  );
  assert.deepEqual(
    classifyAssetPlatformKeys('Nocta_0.1.0-alpha.13_macos_aarch64.app.tar.gz'),
    ['darwin-aarch64']
  );
  assert.deepEqual(
    classifyAssetPlatformKeys('Nocta_0.1.0-alpha.13_macos_x64.app.tar.gz'),
    ['darwin-x86_64']
  );
  assert.deepEqual(
    classifyAssetPlatformKeys('Nocta_0.1.0-alpha.13_linux_amd64.deb'),
    ['linux-x86_64', 'linux-x86_64-deb']
  );
  assert.deepEqual(
    classifyAssetPlatformKeys('Nocta_0.1.0-alpha.13_macos_aarch64.dmg'),
    []
  );
  assert.deepEqual(
    classifyAssetPlatformKeys('Nocta_0.1.0-alpha.13_windows_x64-setup.exe.sig'),
    []
  );
});

test('buildUpdaterManifest assembles valid Tauri v2 manifest and skips missing signatures', () => {
  const signatures = {
    'Nocta_0.1.0-alpha.13_windows_x64-setup.exe.sig': 'win-sig\n',
    'Nocta_0.1.0-alpha.13_macos_aarch64.app.tar.gz.sig': '  arm-sig  ',
    'Nocta_0.1.0-alpha.13_macos_x64.app.tar.gz.sig': 'intel-sig',
    'Nocta_0.1.0-alpha.13_linux_amd64.deb.sig': '',
  };

  const manifest = buildUpdaterManifest({
    version: 'v0.1.0-alpha.13',
    notes: '### Release Notes\n- Auto updater support',
    pubDate: '2026-11-21T09:30:00.000Z',
    assets: [
      {
        name: 'Nocta_0.1.0-alpha.13_windows_x64-setup.exe',
        url: 'https://github.com/wade6716/Nocta/releases/download/v0.1.0-alpha.13/Nocta_0.1.0-alpha.13_windows_x64-setup.exe',
      },
      {
        name: 'Nocta_0.1.0-alpha.13_windows_x64-setup.exe.sig',
        url: 'https://github.com/wade6716/Nocta/releases/download/v0.1.0-alpha.13/Nocta_0.1.0-alpha.13_windows_x64-setup.exe.sig',
      },
      {
        name: 'Nocta_0.1.0-alpha.13_macos_aarch64.app.tar.gz',
        url: 'https://github.com/wade6716/Nocta/releases/download/v0.1.0-alpha.13/Nocta_0.1.0-alpha.13_macos_aarch64.app.tar.gz',
      },
      {
        name: 'Nocta_0.1.0-alpha.13_macos_aarch64.app.tar.gz.sig',
        url: 'https://github.com/wade6716/Nocta/releases/download/v0.1.0-alpha.13/Nocta_0.1.0-alpha.13_macos_aarch64.app.tar.gz.sig',
      },
      {
        name: 'Nocta_0.1.0-alpha.13_macos_x64.app.tar.gz',
        url: 'https://github.com/wade6716/Nocta/releases/download/v0.1.0-alpha.13/Nocta_0.1.0-alpha.13_macos_x64.app.tar.gz',
      },
      {
        name: 'Nocta_0.1.0-alpha.13_macos_x64.app.tar.gz.sig',
        url: 'https://github.com/wade6716/Nocta/releases/download/v0.1.0-alpha.13/Nocta_0.1.0-alpha.13_macos_x64.app.tar.gz.sig',
      },
      {
        name: 'Nocta_0.1.0-alpha.13_linux_amd64.deb',
        url: 'https://github.com/wade6716/Nocta/releases/download/v0.1.0-alpha.13/Nocta_0.1.0-alpha.13_linux_amd64.deb',
      },
      {
        name: 'Nocta_0.1.0-alpha.13_linux_amd64.deb.sig',
        url: 'https://github.com/wade6716/Nocta/releases/download/v0.1.0-alpha.13/Nocta_0.1.0-alpha.13_linux_amd64.deb.sig',
      },
    ],
    readSignature: (name) => signatures[name] ?? '',
  });

  assert.equal(manifest.version, '0.1.0-alpha.13');
  assert.equal(manifest.pub_date, '2026-11-21T09:30:00.000Z');
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'win-sig');
  assert.equal(manifest.platforms['windows-x86_64-nsis'].signature, 'win-sig');
  assert.equal(manifest.platforms['darwin-aarch64'].signature, 'arm-sig');
  assert.equal(manifest.platforms['darwin-x86_64'].signature, 'intel-sig');
  assert.equal(manifest.platforms['linux-x86_64'], undefined);
  assert.equal(manifest.platforms['linux-x86_64-deb'], undefined);
});
