/*
 * 个人工作台 Service Worker（手写，无构建步骤）。
 * 策略：
 *  - 应用外壳（/、manifest、图标）：预缓存，导航请求网络优先、断网回退外壳；
 *  - /assets/ 带 hash 的静态资源、/icons/：缓存优先；
 *  - /api/ GET：**先返回缓存（假如有）再后台刷新**（stale-while-revalidate），
 *    这样打开页面立刻能看到上次的内容；后台拿到新数据且与缓存不同时，
 *    会把新数据写入缓存并通知页面静默重载。登录态接口（/api/auth/）不缓存。
 *  - /files/ 附件与 /api/thumbs/ 缩略图：缓存优先（凭证、图片基本不变），未命中走网络并回填。
 * 所有缓存只写 ok 响应，避免把 401（未登录）结果缓存成“永久打不开”。
 */
const SHELL_CACHE = 'workbench-shell';
const DATA_CACHE = 'workbench-data';
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

/** 登录态相关接口必须实时，缓存会导致“已登录/未登录”判断错乱。 */
const NEVER_CACHE_API_PREFIXES = ['/api/auth/'];

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

/** 页面完成写入操作后调用：丢弃接口缓存，避免随后读到刚被改动的旧数据。 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'invalidate-api') {
    event.waitUntil(caches.delete(DATA_CACHE));
  }
});

/** 通知所有页面：后台刷新拿到了新数据，可以静默重载。 */
async function notifyApiUpdated() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'api-updated' });
  }
}

/** 通知限流：一次打开会并发多个接口，避免把页面刷成风暴。 */
let lastNotifyAt = 0;
function notifyApiUpdatedThrottled() {
  const now = Date.now();
  if (now - lastNotifyAt < 1500) return;
  lastNotifyAt = now;
  return notifyApiUpdated();
}

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

  // 缩略图走下面的「缓存优先」分支，避免对图片字节做文本处理。
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/thumbs/')) {
    const cacheable = !NEVER_CACHE_API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    event.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      const cached = cacheable ? await cache.match(request) : undefined;

      // 后台刷新的职责只有两件事：把最新数据写进缓存、通知页面可以重载。
      const revalidate = async () => {
        try {
          const response = await fetch(request);
          if (cacheable && response.ok) {
            try {
              await cache.put(request, response.clone());
            } catch {
              // 缓存写入失败（例如配额不足）不影响本次响应。
            }
            if (cached) notifyApiUpdatedThrottled();
          }
          return response;
        } catch (error) {
          if (cached) return cached;
          throw error;
        }
      };

      if (!cached) return revalidate();
      // 先给缓存内容让页面秒开，后台继续刷新；刷新失败也已有内容可看。
      event.waitUntil(revalidate().catch(() => undefined));
      return cached;
    })());
    return;
  }

  if (url.pathname.startsWith('/files/') || url.pathname.startsWith('/api/thumbs/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const isAttachmentOrThumbnail = url.pathname.startsWith('/files/') || url.pathname.startsWith('/api/thumbs/');
        const cache = await caches.open(isAttachmentOrThumbnail ? DATA_CACHE : SHELL_CACHE);
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
