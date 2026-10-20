import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { startAccount } from './lib/account';
import './styles/base.css';

startAccount();
createApp(App).use(router).mount('#app');
