// Minimal service worker so the app can be installed ("Get the app").
// It caches nothing: every request goes to the network, so financial data is
// never stored on the device and figures are always current.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // let the browser handle the request normally
});
