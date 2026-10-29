import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initSpeech } from './utils/speech'
import './styles/base.css'

initSpeech()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
