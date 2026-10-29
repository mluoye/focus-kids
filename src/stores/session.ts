import { defineStore } from 'pinia'
import { api, clearSession, getToken, setSession, storedProfileId, storedRole } from '@/api/client'

interface ProfileBrief {
  id: string
  name: string
  avatar: string
  points: number
}

/** 上次登录的孩子 id：只在 /select 页用于默认高亮，不属于服务端数据。 */
const LAST_KID_KEY = 'fk.lastKidId'
function loadLastKidId(): string {
  try {
    return localStorage.getItem(LAST_KID_KEY) ?? ''
  } catch {
    return ''
  }
}
function saveLastKidId(id: string) {
  try {
    if (id) localStorage.setItem(LAST_KID_KEY, id)
    else localStorage.removeItem(LAST_KID_KEY)
  } catch {
    /* 存储不可用时忽略，只影响默认高亮 */
  }
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    token: getToken(),
    role: storedRole() as '' | 'parent' | 'child',
    profileId: storedProfileId(),
    profile: null as ProfileBrief | null,
    familyUsername: '',
    familyHasRecoveryCode: false,
    familyRecoveryUpdatedAt: 0,
    temporaryParent: false,
    loading: false,
    lastKidId: loadLastKidId(),
  }),
  getters: {
    isParent: (s) => s.role === 'parent',
    isChild: (s) => s.role === 'child',
    loggedIn: (s) => !!s.token && (s.role === 'parent' || s.role === 'child'),
  },
  actions: {
    async loginParent(username: string, password: string) {
      const data = await api.loginParent(username, password)
      setSession(data.token, 'parent')
      this.token = data.token
      this.role = 'parent'
      this.profileId = ''
      this.profile = null
      this.temporaryParent = false
    },
    async registerParent(username: string, password: string): Promise<string> {
      const data = await api.registerParent(username, password)
      setSession(data.token, 'parent')
      this.token = data.token
      this.role = 'parent'
      this.profileId = ''
      this.profile = null
      this.familyUsername = data.username ?? username
      this.familyHasRecoveryCode = !!data.recoveryCode
      this.familyRecoveryUpdatedAt = data.recoveryCode ? Date.now() : 0
      return String(data.recoveryCode ?? '')
    },
    /** 忘记密码：恢复码 + 新密码，成功后自动登录（恢复码不依赖账号名）。 */
    async recoverParent(recoveryCode: string, newPassword: string) {
      const data = await api.recoverParent(recoveryCode, newPassword)
      setSession(data.token, 'parent')
      this.token = data.token
      this.role = 'parent'
      this.profileId = ''
      this.profile = null
      this.temporaryParent = false
      this.familyUsername = data.username ?? this.familyUsername
    },
    async changeParentUsername(username: string, currentPassword: string) {
      const data = await api.changeParentUsername(currentPassword, username)
      this.familyUsername = data.username ?? username
    },
    async changeParentPassword(currentPassword: string, newPassword: string) {
      await api.changeParentPassword(currentPassword, newPassword)
    },
    async regenerateRecoveryCode(currentPassword: string): Promise<string> {
      const data = await api.regenerateRecoveryCode(currentPassword)
      this.familyHasRecoveryCode = true
      this.familyRecoveryUpdatedAt = data.recoveryUpdatedAt ?? Date.now()
      return String(data.recoveryCode ?? '')
    },
    async loginChild(profileId: string, pin: string) {
      const data = await api.loginChild(profileId, pin)
      setSession(data.token, 'child', data.profileId)
      this.token = data.token
      this.role = 'child'
      this.profileId = data.profileId
      this.lastKidId = data.profileId
      saveLastKidId(data.profileId)
    },
    async unlockParent(password: string) {
      if (this.role === 'child' && this.token) {
        try {
          localStorage.setItem(
            'fk.childSession',
            JSON.stringify({ token: this.token, profileId: this.profileId, profile: this.profile }),
          )
        } catch (err) {
          // 存不下只影响「返回孩子模式」的快捷入口，不要因此挡住家长解锁
          console.warn('[session] 暂存孩子会话失败', err)
        }
      }
      const data = await api.parentUnlock(password)
      setSession(data.token, 'parent')
      this.token = data.token
      this.role = 'parent'
      this.temporaryParent = true
    },
    returnToChild(): boolean {
      const raw = localStorage.getItem('fk.childSession')
      localStorage.removeItem('fk.childSession')
      if (!raw) return false
      try {
        const backup = JSON.parse(raw)
        setSession(backup.token, 'child', backup.profileId)
        this.token = backup.token
        this.role = 'child'
        this.profileId = backup.profileId
        this.profile = backup.profile ?? null
        this.temporaryParent = false
        return true
      } catch {
        return false
      }
    },
    async refreshMe() {
      if (!this.token) return
      try {
        const me = await api.me()
        this.role = me.role
        this.profile = me.profile
        this.familyUsername = me.family?.username ?? ''
        this.familyHasRecoveryCode = !!me.family?.hasRecoveryCode
        this.familyRecoveryUpdatedAt = Number(me.family?.recoveryUpdatedAt ?? 0)
        if (me.role === 'child' && me.profile) {
          this.profileId = me.profile.id
        }
      } catch (err: any) {
        // 只有「凭证真的失效」才登出；网络离线时保留登录态，否则离线模式直接不可用
        if (err?.status === 401 || err?.status === 403) this.reset()
        else console.warn('[session] 会话校验失败，保留本地登录态', err)
      }
    },
    reset() {
      clearSession()
      this.token = ''
      this.role = ''
      this.profileId = ''
      this.profile = null
      this.familyUsername = ''
      this.familyHasRecoveryCode = false
      this.familyRecoveryUpdatedAt = 0
      this.temporaryParent = false
    },
    async logout() {
      try {
        await api.logout()
      } catch {
        /* 离线时直接本地退出 */
      }
      this.reset()
    },
  },
})
