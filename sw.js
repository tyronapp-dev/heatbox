// HeaTBox Cloud - Service Worker v3.0
// FIXES: PARALLEL=50, schnellerer Download, alle Icons korrekt

const CACHE_NAME  = 'heatbox-app-shell-v3.0';
const COVER_CACHE = 'heatbox-covers-v1';
const AUDIO_CACHE = 'heatbox-audio-v1';

const APP_SHELL = [
    './',
    './index.html',
    './app2.js',
    './style2.css',
    './manifest.json',
    './icon-180.png',
    './icon-192.png',
    './icon-512.png',
    'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js'
];

// ──────────────────────────────────────────────────────────
// INSTALL – App-Shell vollständig cachen
// ──────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.allSettled(APP_SHELL.map(url =>
                cache.add(url).catch(() => console.warn('[SW] Cache miss:', url))
            ))
        ).then(() => self.skipWaiting())
    );
});

// ──────────────────────────────────────────────────────────
// ACTIVATE – Alte Caches löschen, sofort übernehmen
// ──────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(names
                .filter(n => n !== CACHE_NAME && n !== COVER_CACHE && n !== AUDIO_CACHE)
                .map(n => caches.delete(n))
            )
        ).then(() => self.clients.claim())
    );
});

// ──────────────────────────────────────────────────────────
// MESSAGE – Bulk-Download & Cache-Management
// ──────────────────────────────────────────────────────────
self.addEventListener('message', async (event) => {
    if (!event.data) return;
    const client = event.source;

    if (event.data.type === 'CACHE_SONG_NOW') {
        const { fileUrl, coverUrl } = event.data;
        const audioCache = await caches.open(AUDIO_CACHE);
        const coverCache = await caches.open(COVER_CACHE);
        try {
            if (!(await audioCache.match(fileUrl))) {
                const r = await fetch(fileUrl);
                if (r.ok) await audioCache.put(fileUrl, r);
            }
        } catch(_) {}
        if (coverUrl && coverUrl.startsWith('http')) {
            try {
                if (!(await coverCache.match(coverUrl))) {
                    const r = await fetch(coverUrl);
                    if (r.ok) await coverCache.put(coverUrl, r);
                }
            } catch(_) {}
        }
        if (client) client.postMessage({ type: 'SONG_CACHED', fileUrl });
        return;
    }

    if (event.data.type === 'CHECK_CACHED') {
        const audioCache = await caches.open(AUDIO_CACHE);
        const cached = await audioCache.match(event.data.fileUrl);
        if (client) client.postMessage({ type: 'CACHED_STATUS', fileUrl: event.data.fileUrl, cached: !!cached });
        return;
    }

    if (event.data.type === 'CACHE_ALL_SONGS') {
        const songs = event.data.songs;
        const audioCache = await caches.open(AUDIO_CACHE);
        const coverCache = await caches.open(COVER_CACHE);
        let done = 0;
        const total = songs.length;
        const PARALLEL = 50;

        async function cacheSong(song) {
            try {
                if (!(await audioCache.match(song.fileUrl))) {
                    const resp = await fetch(song.fileUrl);
                    if (resp.ok) await audioCache.put(song.fileUrl, resp);
                }
            } catch(_) {}
            if (song.coverUrl && song.coverUrl.startsWith('http')) {
                try {
                    if (!(await coverCache.match(song.coverUrl))) {
                        const resp = await fetch(song.coverUrl);
                        if (resp.ok) await coverCache.put(song.coverUrl, resp);
                    }
                } catch(_) {}
            }
            done++;
            if (client) client.postMessage({ type: 'CACHE_PROGRESS', done, total, title: song.title });
        }

        for (let i = 0; i < songs.length; i += PARALLEL)
            await Promise.all(songs.slice(i, i + PARALLEL).map(cacheSong));

        if (client) client.postMessage({ type: 'CACHE_COMPLETE', total });
    }

    if (event.data.type === 'CLEAR_AUDIO_CACHE') {
        await caches.delete(AUDIO_CACHE);
        if (client) client.postMessage({ type: 'CACHE_CLEARED' });
    }

    if (event.data.type === 'GET_CACHE_INFO') {
        const audioCache = await caches.open(AUDIO_CACHE);
        const keys = await audioCache.keys();
        if (client) client.postMessage({ type: 'CACHE_INFO', count: keys.length });
    }
});

// ──────────────────────────────────────────────────────────
// FETCH – Request-Strategien
// ──────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. Audio – Cache-first mit Range-Request-Support (für Seeking auf iOS!)
    if (
        event.request.destination === 'audio' ||
        url.pathname.endsWith('.mp3') ||
        url.pathname.endsWith('.flac') ||
        url.pathname.endsWith('.m4a') ||
        url.hostname.includes('r2.cloudflarestorage') ||
        url.hostname.includes('workers.dev')
    ) {
        event.respondWith(
            caches.open(AUDIO_CACHE).then(async (cache) => {
                const cached = await cache.match(event.request.url);
                if (cached) {
                    const rangeHeader = event.request.headers.get('range');
                    if (rangeHeader) {
                        const buf   = await cached.clone().arrayBuffer();
                        const total = buf.byteLength;
                        const m     = rangeHeader.match(/bytes=(\d+)-(\d*)/);
                        const start = parseInt(m[1], 10);
                        const end   = m[2] ? parseInt(m[2], 10) : total - 1;
                        return new Response(buf.slice(start, end + 1), {
                            status: 206, statusText: 'Partial Content',
                            headers: {
                                'Content-Type':  cached.headers.get('Content-Type') || 'audio/mpeg',
                                'Content-Range': `bytes ${start}-${end}/${total}`,
                                'Content-Length': String(end - start + 1),
                                'Accept-Ranges': 'bytes'
                            }
                        });
                    }
                    return cached;
                }
                return fetch(event.request).catch(() =>
                    new Response('', { status: 503, statusText: 'Offline' })
                );
            })
        );
        return;
    }

    // 2. Cover-Bilder – Cache-first, Fallback auf leeres SVG
    if (
        event.request.destination === 'image' ||
        url.pathname.match(/\.(jpg|jpeg|png|webp|gif)$/) ||
        url.hostname.includes('mzstatic.com')
    ) {
        event.respondWith(
            caches.open(COVER_CACHE).then(async (cache) => {
                const cached = await cache.match(event.request);
                if (cached) return cached;
                try {
                    const response = await fetch(event.request);
                    if (response.status === 200) cache.put(event.request, response.clone());
                    return response;
                } catch (e) {
                    return new Response(
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="#1c1c1e" width="1" height="1"/></svg>',
                        { headers: { 'Content-Type': 'image/svg+xml' } }
                    );
                }
            })
        );
        return;
    }

    // 3. App-Shell & CDN – Cache-FIRST (sofort offline ladbar!)
    // WICHTIG: Erst Cache prüfen → liefern → im Hintergrund aktualisieren
    // Vorher war hier ein Bug: App konnte offline nicht geöffnet werden!
    if (
        url.hostname === self.location.hostname ||
        url.hostname.includes('cdn.jsdelivr.net')
    ) {
        event.respondWith(
            caches.match(event.request).then(async (cached) => {
                // Gefunden → sofort ausliefern, Hintergrund-Update starten
                if (cached) {
                    fetch(event.request).then(r => {
                        if (r && r.status === 200)
                            caches.open(CACHE_NAME).then(c => c.put(event.request, r.clone()));
                    }).catch(() => {});
                    return cached;
                }
                // Nicht gecacht → Netzwerk versuchen
                try {
                    const response = await fetch(event.request);
                    if (response && response.status === 200)
                        caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
                    return response;
                } catch(e) {
                    // Offline + nicht gecacht → index.html als Fallback
                    return caches.match('./index.html');
                }
            })
        );
        return;
    }

    // 4. API (Cloudflare) – Netzwerk mit Timeout, graceful offline
    event.respondWith(
        Promise.race([
            fetch(event.request),
            new Promise((_, reject) => setTimeout(() => reject(), 8000))
        ]).catch(() =>
            new Response(JSON.stringify({ error: 'offline' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            })
        )
    );
});