import { defineStore } from 'pinia'

interface Toast {
  id: number
  text: string
}

let toastSeq = 0

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [] as Toast[],
    online: true,
  }),
  actions: {
    toast(text: string, timeout = 2600) {
      const id = ++toastSeq
      this.toasts.push({ id, text })
      window.setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id)
      }, timeout)
    },
    setOnline(value: boolean) {
      this.online = value
    },
  },
})
