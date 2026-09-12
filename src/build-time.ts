/**
 * 构建产物里的时间戳。
 *
 * 默认取当前时间。若设置了 `SOURCE_DATE_EPOCH`（可复现构建的通行约定，值是 Unix 秒），
 * 就用它——这样任何人都能让产物与本仓库**逐字节**一致：
 *
 * ```bash
 * SOURCE_DATE_EPOCH=1789000000 npm run check      # bash
 * $env:SOURCE_DATE_EPOCH = "1789000000"; npm run check   # PowerShell
 * ```
 *
 * 为什么值得留这个口子：实测同一份冻结快照连续构建两次，条目、章节、案例与快照哈希
 * 全部逐字节一致，**唯一的非确定项就是这个时间戳**。要证明"产物能从快照重建"，
 * 就需要一个能让两次构建完全相同的开关——否则这句承诺只能靠嘴说。
 */
export function buildTimestamp(): string {
  const raw = process.env.SOURCE_DATE_EPOCH
  if (raw === undefined || raw.trim() === '') return new Date().toISOString()

  const seconds = Number(raw.trim())
  if (!Number.isFinite(seconds) || seconds < 0) {
    // 宁可响亮失败：环境里给了这个变量，就说明调用方要的是可复现构建。
    // 值不合法时悄悄退回当前时间，会给出一个"看起来可复现、其实不可复现"的产物。
    throw new Error(`SOURCE_DATE_EPOCH 不是合法的 Unix 秒数：${JSON.stringify(raw)}`)
  }
  return new Date(seconds * 1000).toISOString()
}
