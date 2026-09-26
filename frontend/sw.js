// CloudVault Service Worker for PWA, Offline Caching & Web Share Target
const CACHE_NAME = 'cloudvault-pwa-v8';
const DB_NAME = 'cloudvault_share_target';
const DB_VERSION = 2;
const STORE_NAME = 'shared_files';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/pwa-icons/icon-192.png',
  '/pwa-icons/icon-192-maskable.png',
  '/pwa-icons/icon-512.png',
  '/pwa-icons/icon-512-maskable.png',
  '/pwa-icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/pwa-companion.js'
];

// Open IndexedDB to store files shared via Web Share Target
function openShareDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Store files in IndexedDB (converting to detached ArrayBuffers so Android content URIs aren't lost)
async function saveSharedFiles(files, title, text, url) {
  const db = await openShareDB();
  const processedFiles = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    try {
      const buffer = await file.arrayBuffer();
      processedFiles.push({
        name: file.name || `shared_media_${Date.now()}_${i + 1}.jpg`,
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified || Date.now(),
        data: buffer,
        size: buffer.byteLength
      });
    } catch (err) {
      console.warn('[SW] Could not read file arrayBuffer, storing raw file:', err);
      processedFiles.push(file);
    }
  }

  if (processedFiles.length === 0) {
    return;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry = {
      timestamp: Date.now(),
      title: title || '',
      text: text || '',
      url: url || '',
      files: processedFiles
    };
    const req = store.add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Precache assets individually to avoid one failure aborting installation
      await Promise.allSettled(
        STATIC_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[SW] Precache skipped for:', asset, err);
          })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })()
  );
});

self.addEventListener('fetch', (event) => {
  let requestUrl;
  try {
    requestUrl = new URL(event.request.url);
  } catch (e) {
    return;
  }

  // Ignore non-HTTP/HTTPS schemes (e.g. chrome-extension://, data:, blob:, etc.)
  if (!requestUrl.protocol.startsWith('http')) {
    return;
  }

  // Handle Web Share Target POST request from system share sheet
  if (requestUrl.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          let files = formData.getAll('files');
          if (!files || files.length === 0) {
            files = formData.getAll('file');
          }
          if (!files || files.length === 0) {
            files = [];
            for (const [key, value] of formData.entries()) {
              if (value && typeof value === 'object' && ('arrayBuffer' in value || 'size' in value)) {
                files.push(value);
              }
            }
          }

          const title = formData.get('title');
          const text = formData.get('text');
          const sharedUrl = formData.get('url');

          if (files && files.length > 0) {
            await saveSharedFiles(files, title, text, sharedUrl);

            // Notify any open clients that shared files are ready to upload
            try {
              const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
              for (const client of clients) {
                client.postMessage({ type: 'CLOUDVULT_SHARED_FILES_READY' });
              }
            } catch (notifyErr) {
              console.warn('[SW] Client broadcast skipped:', notifyErr);
            }
          }

          // Use absolute URL for Response.redirect to avoid Fetch TypeError
          const redirectTarget = new URL('/dashboard?shared=1', event.request.url).href;
          return Response.redirect(redirectTarget, 303);
        } catch (err) {
          console.error('[SW] Share target processing failed:', err);
          const fallbackTarget = new URL('/dashboard', event.request.url).href;
          return Response.redirect(fallbackTarget, 303);
        }
      })()
    );
    return;
  }

  // Never intercept media streams, video/audio elements, Range requests, or stream/download endpoints!
  // Bypassing the Service Worker allows native browser byte-range seeking (HTTP 206) to work directly and instantly.
  if (
    event.request.headers.has('range') ||
    event.request.destination === 'video' ||
    event.request.destination === 'audio' ||
    requestUrl.pathname.startsWith('/api') ||
    requestUrl.pathname.startsWith('/tg/') ||
    requestUrl.pathname.startsWith('/s/') ||
    requestUrl.pathname.startsWith('/t/') ||
    requestUrl.pathname.startsWith('/d/') ||
    requestUrl.pathname.startsWith('/stream')
  ) {
    return;
  }

  // Network-first for HTML / navigation with offline SPA fallback, Stale-while-revalidate for static assets
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              if (event.request.url.startsWith('http://') || event.request.url.startsWith('https://')) {
                cache.put(event.request, responseClone).catch(() => {});
              }
            }).catch(() => {});
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // If this is a navigation request, serve the cached SPA index page
          if (event.request.mode === 'navigate') {
            const rootCached = await caches.match('/');
            if (rootCached) return rootCached;
            const indexCached = await caches.match('/index.html');
            if (indexCached) return indexCached;
          }
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
          });
        })
    );
  }
});
