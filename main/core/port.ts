// 从进程输出里识别本地监听端口
const REGEXES: RegExp[] = [
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:(\d{2,5})/g,
  /localhost:(\d{2,5})/g,
  /Local:\s+https?:\/\/[^:\s]+:(\d{2,5})/g,
  /Port\s+(\d{2,5})/gi,
  /listening on.*?(\d{2,5})/gi,
]

export function detectPort(text: string): number | null {
  for (const re of REGEXES) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m) {
      const p = Number.parseInt(m[1], 10)
      if (p > 0 && p < 65536)
        return p
    }
  }
  return null
}
