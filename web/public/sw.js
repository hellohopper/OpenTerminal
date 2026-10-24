// Cache only the public offline screen and icons. Authenticated pages and API data
// never enter Cache Storage, including after sign-out or a server change.
const CACHE = 'openterminal-public-v1';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/app-icon-192.png'])).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('openterminal-public-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(async () => (await caches.match('/offline.html')) || Response.error()));
  else if (['/offline.html', '/app-icon-192.png'].includes(url.pathname) && !url.search) event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
self.addEventListener('push',event=>{let data={};try{data=event.data.json();}catch{}const symbol=typeof data.symbol==='string'&&/^[A-Z0-9.^=&-]{1,20}$/.test(data.symbol)?data.symbol:'';event.waitUntil(self.registration.showNotification(String(data.title||'OpenTerminal').slice(0,120),{body:String(data.body||'A market alert is available.').slice(0,500),tag:String(data.tag||'terminal').slice(0,100),icon:'/app-icon-192.png',data:{symbol}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const symbol=event.notification.data?.symbol||'';event.waitUntil(clients.openWindow('/?research='+encodeURIComponent(symbol)));});
