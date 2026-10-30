import { APP_VERSION } from '@shared/constants'

/** GitHub 发布仓库；纯前端直连 GitHub Releases API，不经过后端路由。 */
const REPO = 'mluoye/focus-kids'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`

/** 自动检查节流：本地每天最多一次。 */
const LAST_CHECK_KEY = 'fk.lastUpdateCheck'
const THROTTLE_MS = 24 * 60 * 60 * 1000

export interface UpdateCheckResult {
  /** 最新版本号（不带 v 前缀），例如 0.9.2 */
  latest: string
  /** 是否比当前版本新 */
  updateAvailable: boolean
  /** 检查时间 */
  checkedAt: number
}

/** 版本号比较：a > b 返回正数，a < b 返回负数，相等 0。 */
export function compareVersions(a: string, b: string): number {
  const pa = (a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = (b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

/** 自动检查是否到了节流窗口（距上次检查超过 24 小时）。 */
export function shouldAutoCheck(): boolean {
  try {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0)
    return !last || Date.now() - last > THROTTLE_MS
  } catch {
    return true
  }
}

function rememberCheck() {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
  } catch {
    /* 存储不可用仅影响节流，不影响手动检查 */
  }
}

/**
 * 检查是否有新版本。纯前端直连 GitHub Releases API（公网，国内可能不稳）。
 * 失败会抛错（含原因），调用方需给出可操作提示，不吞原因。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  let res: Response
  try {
    res = await fetch(API_URL, {
      headers: { accept: 'application/vnd.github+json' },
    })
  } catch {
    throw new Error('无法连接 GitHub（网络不可达或已被拦截），请检查网络后重试')
  }
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('未找到发布版本：请确认仓库已设为公开，并已创建至少一个 Release（如 v0.9.1）')
    }
    throw new Error(`更新检查失败（HTTP ${res.status}），请稍后重试`)
  }
  let data: any
  try {
    data = await res.json()
  } catch {
    throw new Error('更新检查返回异常，请稍后重试')
  }
  const latest = String(data?.tag_name ?? '').replace(/^v/i, '')
  if (!latest) throw new Error('未获取到最新版本号，请稍后重试')
  const result: UpdateCheckResult = {
    latest,
    updateAvailable: compareVersions(latest, APP_VERSION) > 0,
    checkedAt: Date.now(),
  }
  rememberCheck()
  return result
}
