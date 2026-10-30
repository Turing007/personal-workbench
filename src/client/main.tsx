import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/app.css';
import './styles/erp.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA：生产构建注册 Service Worker（外壳预缓存 + 最近数据只读缓存）。
// 开发模式不注册，避免 Vite 热更新被缓存干扰；注册失败不影响任何功能。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 离线缓存不可用时按普通网页运行 */ });
  });
}
