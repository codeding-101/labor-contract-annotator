import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // 引擎源码在仓库根目录的 src/，开发服务器需要被允许读取上层目录
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
})
