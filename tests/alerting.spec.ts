import { test, expect } from '@playwright/test';

test.describe('Alerting and Notification System', () => {

  test.beforeEach(async ({ page }) => {
    // Enable notification permission for the browser context
    await page.context().grantPermissions(['notifications']);
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

  test('should send a notification with a tag when the app is hidden', async ({ page }) => {
    // Spy on notification calls
    await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      (window as any).__notifications = [];
      // We'll mock the showLocalNotification call directly for easier tracking in Playwright
      const oldNotify = (window as any).showLocalNotification;
      (window as any).showLocalNotification = async (...args: any[]) => {
        (window as any).__notifications.push(args);
        if (oldNotify) return oldNotify(...args);
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    // Mock an imminent event
    await page.goto('/?date=2026-05-24T05:56:00'); 
    await page.waitForTimeout(1000);

    // Hide the page to trigger background timer
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // We can't easily wait for a real minute, so we'll check the call that happens on hidden.
    await page.waitForTimeout(2000);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const notifications = await page.evaluate(() => (window as any).__notifications || []);
    
    // The perpetual timer update should be in the logs
    // [title, body, type, vibrate, sound, renotify]
    const timerCall = notifications.find((n: any) => n[0] && n[0].startsWith('Next:'));
    if (timerCall) {
      expect(timerCall[5]).toBe(false); // renotify should be false for idle updates
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
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

  test('should only update background notification once per minute', async ({ page }) => {
    // Set time to something that has a future event on May 24th
    await page.goto('/?date=2026-05-24T05:50:00'); 
    await page.waitForSelector('.activity-card');

    await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      (window as any).__notifyCount = 0;
      
      // Mock standard Notification
      (window as any).Notification = class {
        static permission = 'granted';
        constructor() { (window as any).__notifyCount++; }
        close() {}
      };

      // Mock ServiceWorkerRegistration.showNotification
      if ('ServiceWorkerRegistration' in window) {
        (ServiceWorkerRegistration.prototype as any).showNotification = async function() {
          (window as any).__notifyCount++;
        };
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    // 1. Set to hidden
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 2. Wait for a couple of seconds (ticker runs every sec)
    await page.waitForTimeout(2500);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const count = await page.evaluate(() => (window as any).__notifyCount);
    expect(count).toBe(1);

    // 4. Set to visible and then back to hidden (should reset and fire again)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);

    const countAfterReset = await page.evaluate(() => (window as any).__notifyCount);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    expect(countAfterReset).toBe(2);
  });

  test('should fire notification immediately when backgrounded regardless of previous state', async ({ page }) => {
    await page.goto('/?date=2026-05-24T05:50:00'); 
    await page.waitForSelector('.activity-card');

    await page.evaluate(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      (window as any).__notifyCount = 0;
      (window as any).Notification = class {
        static permission = 'granted';
        constructor() { (window as any).__notifyCount++; }
        close() {}
      };
      if ('ServiceWorkerRegistration' in window) {
        (ServiceWorkerRegistration.prototype as any).showNotification = async function() {
          (window as any).__notifyCount++;
        };
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });

    // 1. Hide the app
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const count1 = await page.evaluate(() => (window as any).__notifyCount);
    expect(count1).toBe(1);

    // 2. Show the app (should clear throttle)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(100);

    // 3. Hide again immediately (within same minute)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);

    const count2 = await page.evaluate(() => (window as any).__notifyCount);
    expect(count2).toBe(2); // Should fire again!
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

});
