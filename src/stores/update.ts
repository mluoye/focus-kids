import { defineStore } from 'pinia'
import { APP_VERSION } from '@shared/constants'
import { checkForUpdate, shouldAutoCheck } from '@/utils/updateCheck'

/** 家长端版本更新状态：顶部栏与「数据管理」页共享同一份检查结果。 */
export const useUpdateStore = defineStore('update', {
  state: () => ({
    latest: '',
    updateAvailable: false,
    checking: false,
    checkedAt: 0,
    /** 最近一次检查的错误（含原因）；空串表示无错误。 */
    error: '',
    /** 最近一次手动检查的结果文案，用于卡片展示。 */
    message: '',
  }),
  actions: {
    /** 进家长端自动检查：本地每天最多一次，只在发现新版时提示。 */
    async autoCheck() {
      if (this.checking || !shouldAutoCheck()) return
      try {
        const r = await checkForUpdate()
        this.latest = r.latest
        this.updateAvailable = r.updateAvailable
        this.checkedAt = r.checkedAt
        this.error = ''
        this.message = r.updateAvailable ? `发现新版本 v${r.latest}` : ''
      } catch (err: any) {
        // 自动检查失败不弹窗打扰，只在卡片留痕；不吞原因
        this.error = err?.message ?? '更新检查失败'
      }
    },
    /** 手动检查：忽略节流，结果给卡片展示。 */
    async manualCheck(): Promise<string> {
      if (this.checking) return this.message || '正在检查…'
      this.checking = true
      this.error = ''
      try {
        const r = await checkForUpdate()
        this.latest = r.latest
        this.updateAvailable = r.updateAvailable
        this.checkedAt = r.checkedAt
        this.message = r.updateAvailable
          ? `发现新版本 v${r.latest}（当前 v${APP_VERSION}）`
          : `已是最新版本（v${APP_VERSION}）`
        return this.message
      } catch (err: any) {
        this.error = err?.message ?? '更新检查失败'
        this.message = this.error
        return this.error
      } finally {
        this.checking = false
      }
    },
  },
})
