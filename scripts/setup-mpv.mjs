#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import SevenZip from '7z-wasm';

const TARGET_DIR = path.join(process.cwd(), 'src-tauri', 'lib');
const TEMP_DIR = path.join(TARGET_DIR, 'temp');
const WRAPPER_BASE_URL = "https://github.com/nini22P/libmpv-wrapper/releases/latest/download";
const MPV_BASE_URL = "https://github.com/zhongfly/mpv-winbuild/releases/latest/download";

const COLORS = {
  Reset: "\x1b[0m",
  Red: "\x1b[31m",
  Green: "\x1b[32m",
  Yellow: "\x1b[33m",
  Cyan: "\x1b[36m",
  Gray: "\x1b[90m",
};

function log(message, color = COLORS.Reset) {
  console.log(`${color}${message}${COLORS.Reset}`);
}

function errorExit(message) {
  console.error(`${COLORS.Red}Error: ${message}${COLORS.Reset}`);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let targetPlatform = null;
  let targetArch = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && i + 1 < args.length) {
      targetPlatform = args[++i].toLowerCase();
    } else if (args[i] === '--arch' && i + 1 < args.length) {
      targetArch = args[++i].toLowerCase();
    }
  }

  // Normalize platform
  let osName = '';
  let wrapperLibName = '';
  const currentPlatform = targetPlatform || os.platform();

  if (currentPlatform === 'win32' || currentPlatform === 'windows') {
    osName = 'windows';
    wrapperLibName = 'libmpv-wrapper.dll';
  } else if (currentPlatform === 'darwin' || currentPlatform === 'macos') {
    osName = 'macos';
    wrapperLibName = 'libmpv-wrapper.dylib';
  } else if (currentPlatform === 'linux') {
    osName = 'linux';
    wrapperLibName = 'libmpv-wrapper.so';
  } else {
    errorExit(`Unsupported platform: ${currentPlatform}`);
  }

  // Normalize arch
  let archName = '';
  const currentArch = targetArch || os.arch();

  if (currentArch === 'x64' || currentArch === 'x86_64') {
    archName = 'x86_64';
  } else if (currentArch === 'arm64' || currentArch === 'aarch64') {
    archName = 'aarch64';
  } else {
    errorExit(`Unsupported architecture: ${currentArch}`);
  }

  return { osName, archName, wrapperLibName };
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  if (!res.body) throw new Error(`Response body is empty for ${url}`);
  const fileStream = fs.createWriteStream(destPath);
  await pipeline(res.body, fileStream);
}

async function extractArchive(archivePath, extractDir) {
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });

  const archiveName = path.basename(archivePath);
  const archiveDir = path.dirname(archivePath);

  log(`  Extracting ${archiveName}...`, COLORS.Cyan);

  const sevenZip = await SevenZip({
    print: () => {},
    printErr: () => {},
  });

  const mountSrc = "/archive_source";
  const mountDest = "/archive_dest";

  sevenZip.FS.mkdir(mountSrc);
  sevenZip.FS.mkdir(mountDest);

  sevenZip.FS.mount(sevenZip.NODEFS, { root: archiveDir }, mountSrc);
  sevenZip.FS.mount(sevenZip.NODEFS, { root: extractDir }, mountDest);

  const vArchivePath = `${mountSrc}/${archiveName}`;
  const args = ["x", vArchivePath, `-o${mountDest}`, "-y"];

  try {
    sevenZip.callMain(args);
  } catch (err) {
    if (!err || err.status !== 0) {
      throw new Error(`7z extraction failed: ${err}`);
    }
  } finally {
    try {
      sevenZip.FS.unmount(mountSrc);
      sevenZip.FS.unmount(mountDest);
    } catch {}
  }
}

function findAndMove(searchDir, fileName, destDir) {
  let foundPath = null;

  function search(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (file.startsWith('.')) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          search(fullPath);
        } else if (file === fileName) {
          foundPath = fullPath;
          return;
        }
      } catch {}
      if (foundPath) return;
    }
  }

  search(searchDir);

  if (foundPath) {
    const destPath = path.join(destDir, fileName);
    fs.renameSync(foundPath, destPath);
    log(`  -> ${fileName} downloaded successfully to ${destPath}`, COLORS.Green);
  } else {
    throw new Error(`${fileName} not found in extracted files.`);
  }
}

async function run() {
  const { osName, archName, wrapperLibName } = parseArgs();
  log(`\n=== Setup libmpv dependencies ===`, COLORS.Yellow);
  log(`Target: ${osName} (${archName})`, COLORS.Yellow);

  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR, { recursive: true });

  // 1. Download and extract libmpv-wrapper
  log("\n[1/2] Processing libmpv-wrapper...", COLORS.Cyan);
  try {
    const shaUrl = `${WRAPPER_BASE_URL}/sha256.txt`;
    const response = await fetch(shaUrl);
    const shaContent = await response.text();
    const searchKey = `libmpv-wrapper-${osName}-${archName}`;
    const line = shaContent.split('\n').find(l => l.includes(searchKey));
    if (!line) throw new Error(`Could not find '${searchKey}' in SHA256 file.`);

    const fileName = line.trim().split(/\s+/).pop();
    log(`  Found wrapper release: ${fileName}`, COLORS.Yellow);
    const zipPath = path.join(TEMP_DIR, fileName);

    log("  Downloading wrapper...");
    await downloadFile(`${WRAPPER_BASE_URL}/${fileName}`, zipPath);

    const extractDir = path.join(TEMP_DIR, 'wrapper_extract');
    await extractArchive(zipPath, extractDir);
    findAndMove(extractDir, wrapperLibName, TARGET_DIR);
  } catch (err) {
    errorExit(`Failed to process libmpv-wrapper: ${err.message}`);
  }

  // 2. Download and extract libmpv on Windows
  if (osName === 'windows') {
    log("\n[2/2] Processing libmpv core for Windows...", COLORS.Cyan);
    try {
      const shaUrl = `${MPV_BASE_URL}/sha256.txt`;
      const response = await fetch(shaUrl);
      const shaContent = await response.text();
      const searchKey = `mpv-dev-lgpl-${archName}`;
      const line = shaContent.split('\n').find(l => l.includes(searchKey) && !l.includes('v3'));
      if (!line) throw new Error(`Could not find '${searchKey}' (non-v3) in SHA256 file.`);

      const fileName = line.trim().split(/\s+/).pop();
      log(`  Found mpv release: ${fileName}`, COLORS.Yellow);
      const archivePath = path.join(TEMP_DIR, fileName);

      log("  Downloading mpv library (this may take a moment)...");
      await downloadFile(`${MPV_BASE_URL}/${fileName}`, archivePath);

      const extractDir = path.join(TEMP_DIR, 'libmpv_extract');
      await extractArchive(archivePath, extractDir);
      findAndMove(extractDir, 'libmpv-2.dll', TARGET_DIR);
    } catch (err) {
      errorExit(`Failed to process libmpv: ${err.message}`);
    }
  } else {
    log(`\n[2/2] Skipping libmpv download for ${osName} (uses system libmpv)`, COLORS.Gray);
    if (osName === 'macos') {
      log("NOTE: On macOS, ensure libmpv is installed via 'brew install mpv'", COLORS.Yellow);
    } else if (osName === 'linux') {
      log("NOTE: On Linux, ensure libmpv is installed via 'sudo apt install libmpv-dev'", COLORS.Yellow);
    }
  }

  log("\nCleaning up temporary files...", COLORS.Gray);
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch {}

  log(`\nSUCCESS! All libraries are set up in src-tauri/lib\n`, COLORS.Green);
}

run().catch((err) => {
  errorExit(err.message);
});
