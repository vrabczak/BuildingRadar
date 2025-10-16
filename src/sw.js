// Dynamic cache name based on timestamp or build hash
const CACHE_NAME = `building-radar-${Date.now()}`;
const STATIC_CACHE_NAME = 'building-radar-static';
const urlsToCache = [
    '/BuildingRadar/',
    '/BuildingRadar/index.html',
    '/BuildingRadar/manifest.json'
];

// Check for updates periodically
const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Install event - cache resources
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    event.waitUntil(
        caches.open(STATIC_CACHE_NAME)
            .then((cache) => {
                console.log('Caching app shell');
                return cache.addAll(urlsToCache);
            })
            .then(() => {
                // Force the waiting service worker to become the active service worker
                return self.skipWaiting();
            })
    );
});

// Activate event - clean up old caches and start update checks
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Keep only the static cache and current cache
                    if (cacheName !== STATIC_CACHE_NAME && cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            // Take control of all pages immediately
            return self.clients.claim();
        }).then(() => {
            // Start periodic update checks
            startUpdateChecks();
        })
    );
});

// Function to check for updates
async function checkForUpdates() {
    try {
        console.log('Checking for updates...');

        // Fetch the main HTML file with cache-busting
        const response = await fetch('/BuildingRadar/index.html?t=' + Date.now(), {
            cache: 'no-cache'
        });

        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE_NAME);
            const cachedResponse = await cache.match('/BuildingRadar/index.html');

            if (cachedResponse) {
                const newContent = await response.text();
                const cachedContent = await cachedResponse.text();

                // Compare content to detect changes
                if (newContent !== cachedContent) {
                    console.log('Update detected! Refreshing cache...');

                    // Clear the cache and re-cache updated content
                    await cache.delete('/BuildingRadar/index.html');
                    await cache.put('/BuildingRadar/index.html', new Response(newContent, {
                        headers: response.headers
                    }));

                    // Notify all clients about the update
                    notifyClientsOfUpdate();
                }
            }
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    }
}

// Function to notify clients of updates
function notifyClientsOfUpdate() {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'UPDATE_AVAILABLE',
                message: 'A new version is available. Refresh to update.'
            });
        });
    });
}

// Start periodic update checks
function startUpdateChecks() {
    // Check immediately
    checkForUpdates();

    // Then check periodically
    setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);
}

// Enhanced fetch event with network-first strategy for HTML
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Network-first strategy for HTML files to ensure fresh content
    if (event.request.destination === 'document' || url.pathname.endsWith('.html')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200) {
                        // Update cache with fresh content
                        const responseClone = response.clone();
                        caches.open(STATIC_CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                        return response;
                    }
                    throw new Error('Network response not ok');
                })
                .catch(() => {
                    // Fallback to cache if network fails
                    console.log('Network failed, serving from cache:', event.request.url);
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Cache-first strategy for other resources (CSS, JS, images, etc.)
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    console.log('Serving from cache:', event.request.url);
                    return response;
                }

                console.log('Fetching from network:', event.request.url);
                return fetch(event.request).then((response) => {
                    // Don't cache non-successful responses
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }

                    // Clone the response as it can only be consumed once
                    const responseToCache = response.clone();

                    caches.open(STATIC_CACHE_NAME)
                        .then((cache) => {
                            cache.put(event.request, responseToCache);
                        });

                    return response;
                });
            })
            .catch(() => {
                // If both cache and network fail, show offline page
                if (event.request.destination === 'document') {
                    return caches.match('/BuildingRadar/index.html');
                }
            })
    );
});

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    } else if (event.data && event.data.type === 'CHECK_UPDATE') {
        checkForUpdates();
    }
});
