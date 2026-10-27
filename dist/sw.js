/**
 * BachatPay Service Worker
 * Caches the app shell for offline-first experience.
 * Built with Arc Studio — https://studio.arc.io
 */

const CACHE = 'bachatpay-v1'
const SHELL = [
  '/',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Network-first for API/RPC calls
  if (request.url.includes('rpc') || request.url.includes('api.coingecko')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
    return
  }
  // Cache-first for assets
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response
        const clone = response.clone()
        caches.open(CACHE).then(cache => cache.put(request, clone))
        return response
      })
    })
  )
})
