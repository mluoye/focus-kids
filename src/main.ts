import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initSpeech } from './utils/speech'
import { markUserInteraction } from './utils/sounds'
import { useDataStore } from './stores/data'
import './styles/base.css'

initSpeech()

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

// 启动网络状态监听，网络恢复时自动同步离线队列
const dataStore = useDataStore(pinia)
dataStore.initNetworkListener()

app.mount('#app')

// 移动端解锁 AudioContext：用户首次交互后才能播放音效
const unlockAudio = () => {
  markUserInteraction()
  window.removeEventListener('click', unlockAudio)
  window.removeEventListener('touchstart', unlockAudio)
  window.removeEventListener('keydown', unlockAudio)
}
window.addEventListener('click', unlockAudio)
window.addEventListener('touchstart', unlockAudio)
window.addEventListener('keydown', unlockAudio)
