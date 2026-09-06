/*
 * 个人工作台 Service Worker（手写，无构建步骤）。
 * 策略：
 *  - 应用外壳（/、manifest、图标）：预缓存，导航请求网络优先、断网回退外壳；
 *  - /assets/ 带 hash 的静态资源、/icons/：缓存优先；
 *  - /api/ GET：网络优先并缓存成功响应，断网时回退最近一次数据（只读查看）；
 *  - /files/ 附件：缓存优先（凭证、图片基本不变），未命中走网络并回填。
 * 所有缓存只写 ok 响应，避免把 401（未登录）结果缓存成“永久打不开”。
 */
const SHELL_CACHE = 'workbench-shell';
const DATA_CACHE = 'workbench-data';
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name !== SHELL_CACHE && name !== DATA_CACHE).map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/files/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(url.pathname.startsWith('/files/') ? DATA_CACHE : SHELL_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = (await caches.match(request)) || (await caches.match('/'));
        if (cached) return cached;
        throw error;
      }
    })());
  }
});
