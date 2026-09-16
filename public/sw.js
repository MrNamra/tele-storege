// CloudVault Service Worker for PWA, Offline Caching & Web Share Target
const CACHE_NAME = 'cloudvault-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// Open IndexedDB to store files shared via Web Share Target
function openShareDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cloudvault_share_target', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('shared_files')) {
        db.createObjectStore('shared_files', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Store files in IndexedDB
async function saveSharedFiles(files, title, text, url) {
  const db = await openShareDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shared_files', 'readwrite');
    const store = tx.objectStore('shared_files');
    const entry = {
      timestamp: Date.now(),
      title: title || '',
      text: text || '',
      url: url || '',
      files: files
    };
    const req = store.add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
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
          const files = formData.getAll('files');
          const title = formData.get('title');
          const text = formData.get('text');
          const sharedUrl = formData.get('url');

          if (files && files.length > 0) {
            await saveSharedFiles(files, title, text, sharedUrl);
          }

          return Response.redirect('/dashboard?shared=1', 303);
        } catch (err) {
          console.error('[SW] Share target processing failed:', err);
          return Response.redirect('/dashboard', 303);
        }
      })()
    );
    return;
  }

  // Allow API requests to go straight to network
  if (requestUrl.pathname.startsWith('/api') || requestUrl.pathname.startsWith('/tg/')) {
    return;
  }

  // Network-first for HTML, Stale-while-revalidate for static assets
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              if (event.request.url.startsWith('http://') || event.request.url.startsWith('https://')) {
                cache.put(event.request, responseClone).catch(() => {});
              }
            }).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
