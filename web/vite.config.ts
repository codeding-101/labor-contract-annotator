import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // 相对基准：GitHub Pages 的项目站点在 /<仓库名>/ 下，绝对路径 /assets/... 会 404。
  // 用相对路径后，本地与任意子路径部署都能直接跑。
  base: './',
  // 引擎源码在仓库根目录的 src/，开发服务器需要被允许读取上层目录
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
})
