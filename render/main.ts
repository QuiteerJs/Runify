import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import 'uno.css'
import './style.css'

createApp(App).use(createPinia()).mount('#app')
