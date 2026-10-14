import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
      // 允许 Vite 直接读取上级目录中的 ../Danmaku 源码
      allow: ['..'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 直接指向独立 clone 的 Danmaku 源码入口，实现零编译等待的同步热更新调试
      danmaku: path.resolve(__dirname, '../Danmaku/src/index.js'),
    },
  },
  optimizeDeps: {
    // 禁止 Vite 预构建缓存 danmaku，确保每次修改源码立即生效
    exclude: ['danmaku'],
  },
});
