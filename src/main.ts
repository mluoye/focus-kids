import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initSpeech } from './utils/speech'
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
