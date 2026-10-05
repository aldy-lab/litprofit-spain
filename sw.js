/* ============================================================
   The calculator, openable with no network
   ============================================================
   Everything else about working offline -- the queue, the signature held
   until it can be sent, a session that survives going out of range -- is
   worth nothing if the page cannot be opened in the first place. On a vessel
   github.io is unreachable, and without this file the fitter gets the
   browser's error page and no way past it.

   WHAT IS CACHED, AND WHY THAT LIST
   ---------------------------------
   The whole app is one HTML file, so the shell is that file plus the
   stylesheet, the four font subsets it pulls in, and the one image on the
   page -- the logo, which is on the sign-in card and in the header. It ships
   no third-party JavaScript and nothing else of its own.

   The logo was missed on the first pass and the offline page came up with a
   broken-image glyph where the brand goes. Nothing errored; it was found by
   looking at a screenshot of the page with the network unplugged.

   THE TWO STRATEGIES
   ------------------
   The page itself is NETWORK FIRST. A calculator that serves yesterday's
   build because it is quicker is a tool that quietly stops matching the
   database it talks to; when there is a network, the newest build wins, and
   the cache is what is left when there is not.

   The fonts are CACHE FIRST. They are the same bytes every time and the only
   thing to gain by asking again is a slower first paint.

   WHAT IS DELIBERATELY NOT TOUCHED
   --------------------------------
   Anything that is not this origin -- which is every Supabase call there is.
   A cached answer to "what acts exist" is a lie with a timestamp on it, and a
   cached answer to a write is worse. Those requests are left to fail the way
   the app already expects them to, which is what the outbox is for.
   ============================================================ */

/* Bumping this name is how a cache is thrown away. The page is network-first
   so a new build does not need it; the fonts would. */
const CACHE = 'litprofit-iberia-calc-v1';

/* Relative to this file, which sits beside index.html at the site root. */
const SHELL = [
  './',
  './index.html',
  './css/fonts.css',
  './assets/brand/logo-lockup.svg',
  './assets/fonts/montserrat-latin.woff2',
  './assets/fonts/montserrat-latin-ext.woff2',
  './assets/fonts/montserrat-cyrillic.woff2',
  './assets/fonts/montserrat-cyrillic-ext.woff2'
];

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* One at a time and forgiving: addAll rejects the whole install if a
       single file 404s, and an install that fails leaves NO cache at all --
       so one renamed font would quietly take the offline page with it. */
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const names = await caches.keys();
    /* Only our own old versions. Cache storage belongs to the ORIGIN, not
       to this path, and aldy-lab.github.io is shared with every other Pages
       site on the account -- "delete everything that is not mine" would
       empty their offline caches too. */
    await Promise.all(names.map(n =>
      (n !== CACHE && n.indexOf('litprofit-iberia-calc-') === 0) ? caches.delete(n) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;   /* Supabase is not ours to cache */

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') ||
                 url.pathname.endsWith('index.html');

  if(isPage){
    ev.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        /* Only a real answer is worth keeping. Caching a 404 or a captive
           portal's redirect would replace the app with the thing that
           interrupted it. */
        if(fresh && fresh.ok && fresh.type === 'basic'){
          const c = await caches.open(CACHE);
          c.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch(e){
        const c = await caches.open(CACHE);
        return (await c.match('./index.html')) || (await c.match('./')) ||
               new Response('Offline, and this page was never cached.',
                            { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  ev.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    if(hit) return hit;
    try {
      const fresh = await fetch(req);
      if(fresh && fresh.ok && fresh.type === 'basic') c.put(req, fresh.clone());
      return fresh;
    } catch(e){
      return new Response('', { status: 504 });
    }
  })());
});
