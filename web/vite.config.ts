import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * 生产构建里注入一条内容安全策略。
 *
 * 目的是把"合同内容不离开设备"从一句声明变成**浏览器强制执行的事实**：
 * `connect-src 'none'` 会拦掉一切 fetch／XMLHttpRequest／WebSocket／EventSource，
 * 跨域也好、同域也好，全都发不出去。这样即使将来有人 fork 后想加埋点或上传，
 * 也会被这条策略挡住——不必信任代码，信任浏览器即可。
 *
 * 只在 `apply: 'build'` 时注入：开发模式注入会把 Vite 的热更新连接一并拦掉。
 */
function privacyPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "connect-src 'none'",
    "form-action 'none'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "base-uri 'none'",
  ].join('; ')

  return {
    name: 'inject-privacy-policy',
    apply: 'build',
    transformIndexHtml(html: string): string {
      return html.replace(
        '</head>',
        `  <meta http-equiv="Content-Security-Policy" content="${policy}" />\n  </head>`,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), privacyPolicy()],
  // 相对基准：GitHub Pages 的项目站点在 /<仓库名>/ 下，绝对路径 /assets/... 会 404。
  // 用相对路径后，本地与任意子路径部署都能直接跑。
  base: './',
  // 引擎源码在仓库根目录的 src/，开发服务器需要被允许读取上层目录
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
})
