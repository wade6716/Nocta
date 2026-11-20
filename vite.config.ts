import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const localDanmakuSrc = path.resolve(__dirname, '../Danmaku/src/index.js');
const hasLocalDanmaku = fs.existsSync(localDanmakuSrc);
const nodeModulesDanmakuSrc = path.resolve(__dirname, 'node_modules/danmaku/src/index.js');
const danmakuEntry = hasLocalDanmaku
  ? localDanmakuSrc
  : fs.existsSync(nodeModulesDanmakuSrc)
  ? nodeModulesDanmakuSrc
  : null;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    'process.env': {},
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 忽略 src-tauri 目录，避免 Rust 编译 target 时产生/锁定的可执行文件触发 EBUSY 异常
      ignored: ['**/src-tauri/**'],
    },
    fs: {
      // 若本地存在同级 ../Danmaku 源码，允许 Vite 读取以支持热更新开发
      allow: hasLocalDanmaku ? ['..'] : ['.'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 优先使用同级 ../Danmaku 源码，否则固定指向 node_modules/danmaku/src/index.js，防止回退到旧版 dist
      ...(danmakuEntry ? { danmaku: danmakuEntry } : {}),
    },
  },
  optimizeDeps: {
    ...(danmakuEntry ? { exclude: ['danmaku'] } : {}),
  },
});
