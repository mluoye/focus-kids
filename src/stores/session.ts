import { defineStore } from 'pinia'
import { api, clearSession, getToken, setSession, storedProfileId, storedRole } from '@/api/client'

interface ProfileBrief {
  id: string
  name: string
  avatar: string
  points: number
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    token: getToken(),
    role: storedRole() as '' | 'parent' | 'child',
    profileId: storedProfileId(),
    profile: null as ProfileBrief | null,
    familyUsername: '',
    temporaryParent: false,
    loading: false,
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
    async registerParent(username: string, password: string) {
      const data = await api.registerParent(username, password)
      setSession(data.token, 'parent')
      this.token = data.token
      this.role = 'parent'
      this.profileId = ''
    },
    async loginChild(profileId: string, pin: string) {
      const data = await api.loginChild(profileId, pin)
      setSession(data.token, 'child', data.profileId)
      this.token = data.token
      this.role = 'child'
      this.profileId = data.profileId
    },
    async unlockParent(password: string) {
      if (this.role === 'child' && this.token) {
        localStorage.setItem(
          'fk.childSession',
          JSON.stringify({ token: this.token, profileId: this.profileId, profile: this.profile }),
        )
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
        if (me.role === 'child' && me.profile) {
          this.profileId = me.profile.id
        }
      } catch {
        this.reset()
      }
    },
    reset() {
      clearSession()
      this.token = ''
      this.role = ''
      this.profileId = ''
      this.profile = null
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
