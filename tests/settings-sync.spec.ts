import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.describe('Settings Synchronization', () => {
  test.setTimeout(60000); // 60s timeout

  test.beforeEach(async ({ page }) => {
    // Setup: Mock PWA environment and permissions
    await page.addInitScript(() => {
      // Mock standalone mode
      Object.defineProperty(window.navigator, 'standalone', { value: true });
      
      // Mock Notification permission
      Object.defineProperty(window, 'Notification', {
        value: {
          permission: 'granted',
          requestPermission: async () => 'granted'
        },
        writable: true
      });

      // Mock PushManager
      Object.defineProperty(window, 'PushManager', { value: {}, writable: true });

      // Mock Service Worker
      const mockServiceWorker = {
        ready: Promise.resolve({
          pushManager: {
            subscribe: async () => ({
              endpoint: 'https://mock-push-service.com/123',
              keys: { auth: 'mock-auth', p256dh: 'mock-p256dh' },
              toJSON: () => ({ endpoint: 'https://mock-push-service.com/123' })
            }),
            getSubscription: async () => null
          }
        }),
        getRegistrations: async () => [],
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      Object.defineProperty(navigator, 'serviceWorker', { value: mockServiceWorker, writable: true });

      // Intercept fetch calls to track syncs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__lastSyncPayload = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__lastUnsubscribePayload = null;
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const [url, options] = args;
        const urlStr = typeof url === 'string' ? url : (url as unknown as Request).url;
        
        if (urlStr.includes('/subscribe')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__lastSyncPayload = JSON.parse(options?.body as string);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ok: true, status: 201, json: async () => ({ success: true }) } as any;
        }

        if (urlStr.includes('/unsubscribe')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__lastUnsubscribePayload = JSON.parse(options?.body as string);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
        }

        // Catch-all for any other remote fetches to prevent crashes
        if (urlStr.startsWith('http') && !urlStr.includes('localhost')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ok: true, status: 200, json: async () => ({}) } as any;
        }

        return originalFetch(...args);
      };

      // Inject mock itinerary cache
      const mockItinerary = {
        title: "Test Itinerary",
        days: [
          {
            day: 1,
            date: "2026-05-24",
            activities: [
              { id: "1", date: "2026-05-24", time: "10:00", title: "Breakfast", type: "food", notes: "", location: "", category: "" }
            ]
          }
        ]
      };
      localStorage.setItem('itinerary_cache', JSON.stringify(mockItinerary));
    });

    await page.goto('/');
  });

  test('should sync devMode to backend when toggled', async ({ page }) => {
    // 1. Open settings
    await page.click('.settings-toggle-btn');
    await page.waitForSelector('.settings-modal');

    // 2. Enable notifications first (this triggers the initial subscribe)
    await page.click('button[aria-label="Toggle notifications"]');
    
    // 3. Toggle Developer Mode
    await page.click('button[aria-label="Toggle developer mode"]');

    // 4. Verify the payload sent to the backend
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.waitForFunction(() => (window as any).__lastSyncPayload !== null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = await page.evaluate(() => (window as any).__lastSyncPayload);
    expect(payload.isDev).toBe(true);
  });

  test('should sync updated minutes to backend when changed', async ({ page }) => {
    await page.click('.settings-toggle-btn');
    await page.waitForSelector('.settings-modal');

    // Enable notifications
    const toggle = page.locator('button[aria-label="Toggle notifications"]');
    await toggle.click();
    
    // Wait for the toggle to become active (indicates state updated)
    await expect(toggle).toHaveClass(/active/);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.waitForFunction(() => (window as any).__lastSyncPayload !== null);
    
    // Clear the payload for the next check
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.evaluate(() => (window as any).__lastSyncPayload = null);

    // Wait for the timing section to expand and chip to be visible
    const chip15 = page.locator('button.settings-chip:has-text("15 min")');
    await chip15.waitFor({ state: 'visible' });

    // Change "Heads-up" minutes by clicking the 15 min chip
    await chip15.click();

    // Wait for the next sync
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.waitForFunction(() => (window as any).__lastSyncPayload !== null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = await page.evaluate(() => (window as any).__lastSyncPayload);
    expect(payload.settings.notifyMinutesBefore).toBe(15);
  });

  test('should send unsubscribe request when notifications are turned off', async ({ page }) => {
    await page.click('.settings-toggle-btn');
    await page.waitForSelector('.settings-modal');

    // 1. Enable notifications
    const toggle = page.locator('button[aria-label="Toggle notifications"]');
    await toggle.click();
    await expect(toggle).toHaveClass(/active/);
    
    // Set up mock subscription for getSubscription so that the "Turning off" path can find it
    await page.evaluate(() => {
      const mockServiceWorker = {
        ready: Promise.resolve({
          pushManager: {
            // This is used by subscribe
            subscribe: async () => ({
              endpoint: 'https://mock-push-service.com/123',
              keys: { auth: 'mock-auth', p256dh: 'mock-p256dh' },
              toJSON: () => ({ endpoint: 'https://mock-push-service.com/123' })
            }),
            // This is used by unsubscribe
            getSubscription: async () => ({
              endpoint: 'https://mock-push-service.com/123',
              unsubscribe: async () => true
            })
          }
        }),
        getRegistrations: async () => [],
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      Object.defineProperty(navigator, 'serviceWorker', { value: mockServiceWorker, writable: true });
    });

    // 2. Disable notifications
    await toggle.click();
    await expect(toggle).not.toHaveClass(/active/);

    // 3. Verify the unsubscribe payload was sent to the backend
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.waitForFunction(() => (window as any).__lastUnsubscribePayload !== null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = await page.evaluate(() => (window as any).__lastUnsubscribePayload);
    expect(payload.endpoint).toBe('https://mock-push-service.com/123');
  });
});
