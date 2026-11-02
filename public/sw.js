/**
 * BachatPay Service Worker v3
 * Network-first for HTML — always gets latest app on mobile.
 * Cache-first for assets (hashed filenames) — fast load.
 */

const CACHE = 'bachatpay-v3'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Always network for: RPC, API, non-GET, cross-origin
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.href.includes('rpc') ||
    url.href.includes('api.') ||
    url.href.includes('coingecko') ||
    url.href.includes('explorer.arc.io')
  ) {
    return
  }

  // Network-first for HTML (/) — ensures mobile always gets latest
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
          return response
        })
        .catch(() => caches.match(request))
    )
    return
  }

  // Cache-first for hashed assets (JS/CSS with content hash in filename)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE).then(cache => cache.put(request, clone))
          }
          return response
        })
      })
    )
    return
  }

  // Network-first for everything else
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request))
  )
})
