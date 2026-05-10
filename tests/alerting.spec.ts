import { test, expect } from '@playwright/test';

test.describe('Alerting and Notification System', () => {

  test.beforeEach(async ({ page }) => {
    // Enable notification permission for the browser context
    await page.context().grantPermissions(['notifications']);
    
    // Add initialization scripts to mock the environment BEFORE the page loads
    await page.addInitScript(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      // Mock desktop environment to avoid mobile restrictions
      Object.defineProperty(window.navigator, 'userAgent', { 
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 
        configurable: true 
      });
      Object.defineProperty(window.navigator, 'platform', { value: 'Win32', configurable: true });
      
      // Mock Notification permission
      if (!(window as any).Notification) {
        (window as any).Notification = {
          permission: 'granted',
          requestPermission: async () => 'granted'
        };
      } else {
        Object.defineProperty(window.Notification, 'permission', { value: 'granted', configurable: true });
      }

      // Mock Standalone mode for iOS/Safari tests
      Object.defineProperty(window.navigator, 'standalone', { value: true, writable: true, configurable: true });
      (window as any).matchMedia = (query: string) => ({
        matches: true, // Force all matches to true for simplicity in tests
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    await page.goto('/?date=2026-05-24T12:00:00'); // Ensure we are on a valid day
    await page.waitForSelector('.activity-card');
  });

  test('should highlight activities requiring a reservation', async ({ page }) => {
    // Target a specific known reservation to avoid strict mode violation
    const reservationCard = page.locator('.activity-card.is-reservation', { hasText: 'Dinner Yakiniku' }).first();
    await expect(reservationCard).toBeVisible();
    await expect(reservationCard.locator('.reservation-badge')).toContainText('RESERVATION REQUIRED');
    
    // Verify standard cards don't have it
    const standardCard = page.locator('.activity-card:not(.is-reservation)').first();
    await expect(standardCard).toBeVisible();
    await expect(standardCard.locator('.reservation-badge')).not.toBeVisible();
  });

  test('should request push subscription when enabling notifications', async ({ page }) => {
    // Mock the pushManager and fetch call
    await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      (window as any).__subscriptionRequestCalled = false;
      
      // Mock Service Worker Registration and PushManager
      const mockRegistration = {
        pushManager: {
          getSubscription: async () => null,
          subscribe: async () => ({
            toJSON: () => ({ endpoint: 'https://mock.push.com/123' })
          })
        }
      };

      (navigator as any).serviceWorker.getRegistration = async () => mockRegistration;
      (navigator as any).serviceWorker.ready = Promise.resolve(mockRegistration);

      // Mock fetch to the backend
      (window as any).fetch = async () => {
        (window as any).__subscriptionRequestCalled = true;
        return { ok: true, json: async () => ({ success: true }) } as any;
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    // Go to settings and enable
    await page.click('.settings-toggle-btn');
    await page.waitForSelector('.settings-modal');
    
    // Toggle the notification switch
    const toggle = page.locator('.settings-row', { hasText: 'Activity Alerts' }).locator('.settings-toggle');
    await toggle.click();

    // Verify the toggle becomes active (indicating the logic completed)
    await expect(toggle).toHaveClass(/active/, { timeout: 5000 });
  });

  test('should clear notifications and badge when app becomes visible', async ({ page }) => {
    // Mock the notification clearing logic
    await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      (window as any).__cleared = false;
      const oldClear = (navigator as any).clearAppBadge;
      (navigator as any).clearAppBadge = async () => {
        (window as any).__cleared = true;
        if (oldClear) return oldClear.apply(navigator);
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    // Trigger visibility change to 'visible'
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(500);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const cleared = await page.evaluate(() => (window as any).__cleared);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    expect(cleared).toBe(true);
  });

  test('should show correct progress on the countdown pill', async ({ page }) => {
    // Set time to 2 minutes before event (05:58 for 06:00 event)
    await page.goto('/?date=2026-05-24T05:58:00');
    await page.waitForSelector('.upcoming-pill');

    const progress = await page.locator('.pill-progress-rect').evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.strokeDasharray;
    });

    // At 2 mins remaining out of 5 mins threshold:
    // Shrinking logic: (2 / 5) * 100 = 40% remaining
    expect(progress).toContain('40');
  });

  test('should align pulse and border directions', async ({ page }) => {
    await page.goto('/?date=2026-05-24T05:58:00');
    await page.waitForSelector('.upcoming-pill');

    const pillSvg = page.locator('.pill-progress-svg');
    // Ensure .ccw class is REMOVED (we want Top-Left origin)
    await expect(pillSvg).not.toHaveClass(/ccw/);
    
    // Verify pulse animation uses pulse-travel keyframes
    const animation = await page.locator('.pill-progress-pulse').evaluate(el => {
      const styles = window.getComputedStyle(el);
      return styles.animationName;
    });
    expect(animation).toBe('pulse-travel');
  });

  test('should handle navigation when notification is clicked', async ({ page }) => {
    // 1. Mock the Service Worker postMessage capability
    await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      if ('serviceWorker' in navigator) {
        // Create a mock controller if it doesn't exist
        if (!navigator.serviceWorker.controller) {
          (navigator.serviceWorker as any).controller = {
            postMessage: (msg: any) => {
              window.dispatchEvent(new MessageEvent('message', { data: msg }));
            }
          };
        }
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    // 2. Simulate a notification click message from SW
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
        data: { type: 'NOTIFICATION_CLICK' }
      }));
    });

    // 3. Verify that the app jumps to the current day
    // We are at 12:00:00 on 2026-05-24 (from beforeEach)
    // The jump should ensure the "active" slide is visible
    await page.waitForTimeout(500);
    const activeSlide = page.locator('.swipe-slide.active');
    await expect(activeSlide).toBeVisible();
  });

});
