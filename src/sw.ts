import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'

/* eslint-disable @typescript-eslint/no-explicit-any */

const swSelf = (self as any)

cleanupOutdatedCaches()

// @ts-expect-error - WB_MANIFEST is injected at build time
precacheAndRoute(self.__WB_MANIFEST)

// Cache Google Sheets API responses
registerRoute(
  ({ url }) => url.origin === 'https://sheets.googleapis.com',
  new NetworkFirst({
    cacheName: 'google-sheets-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 7 // 1 week
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200]
      })
    ]
  })
)

swSelf.addEventListener('push', (event: any) => {
  let data = { title: 'New Alert', body: 'Open the app to see what\'s next.', type: 'info', tag: 'itinerary-alert' };
  
  if (event.data) {
    try {
      data = Object.assign(data, event.data.json());
    } catch {
      data.body = event.data.text();
    }
  }

  const options: any = {
    body: data.body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag: data.tag,
    renotify: true,
    data: { url: swSelf.location.origin }
  };

  if (data.type === 'urgent') {
    options.vibrate = [150, 50, 150, 50, 150];
  } else {
    options.vibrate = [120, 40, 120];
  }

  event.waitUntil(
    swSelf.registration.getNotifications({ tag: data.tag }).then((notifications: any[]) => {
      // Force close existing notifications with the same tag to prevent stacking on all platforms
      notifications.forEach((n: any) => n.close());
      return swSelf.registration.showNotification(data.title, options);
    })
  );
});

swSelf.addEventListener('notificationclick', (event: any) => {
  event.notification.close()

  const urlToOpen = new URL(swSelf.location.origin)
  urlToOpen.searchParams.set('from_notification', '1')

  event.waitUntil(
    swSelf.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients: any[]) => {
      // 1. Try to focus an existing window
      for (const client of windowClients) {
        if (client.url === urlToOpen.href || client.url === swSelf.location.origin + '/') {
          if ('focus' in client) {
            // Send a message to the client to trigger navigation
            client.postMessage({ type: 'NOTIFICATION_CLICK' });
            return client.focus();
          }
        }
      }
      
      // 2. Otherwise open a new window
      if (swSelf.clients.openWindow) {
        return swSelf.clients.openWindow(urlToOpen.href);
      }
    })
  );
});
