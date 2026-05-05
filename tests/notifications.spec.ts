import { test, expect } from '@playwright/test';

test.describe('Push Notifications & Haptics', () => {

  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['notifications']);
  });

  const setupSpies = async (page) => {
    await page.addInitScript(() => {
      // Force permission to granted
      Object.defineProperty(window.Notification, 'permission', { get: () => 'granted' });
      
      window.__notifications = [];
      window.__vibrations = [];
      
      // Spy on showLocalNotification
      const originalShow = (window as unknown as { showLocalNotification: typeof showLocalNotification }).showLocalNotification;
      (window as unknown as { showLocalNotification: unknown }).showLocalNotification = async (title: string, body: string) => {
        window.__notifications.push({ title, body });
        if (originalShow) return originalShow(title, body);
      };

      // Spy on navigator.vibrate
      navigator.vibrate = (pattern) => {
        window.__vibrations.push(pattern);
        return true;
      };
    });
  };

  test('should trigger a manual test notification via query parameter', async ({ page }) => {
    await setupSpies(page);
    await page.goto('/?notify=Test+Alert');
    
    // Wait for the 1s delay in App.tsx
    await page.waitForTimeout(2000);

    const notifications = await page.evaluate(() => window.__notifications);
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].title).toBe('Test Notification');
    expect(notifications[0].body).toBe('Test Alert');
  });

  test('should trigger automatic notifications when nearing an activity', async ({ page }) => {
    await setupSpies(page);
    // Arrival & Check-in at 11:30. Set time to 11:21 (9m before)
    await page.goto('/?date=2026-05-24T11:21:00');
    
    await page.waitForTimeout(2000);

    const notifications = await page.evaluate(() => window.__notifications);
    const tenMinAlert = notifications.find(n => n.title.includes('Upcoming'));
    expect(tenMinAlert).toBeDefined();
    expect(tenMinAlert.title).toContain('Arrival & Check-in');
  });

  test('DEBUG SYNC: should jump clock and trigger notification when clicking day in debug mode', async ({ page }) => {
    await setupSpies(page);
    // Start in debug mode
    await page.goto('/?debug=1');
    await page.waitForSelector('.day-btn');
    await page.waitForTimeout(1000); // Wait for initialization

    // Click Day 2
    const day2Btn = page.locator('.day-btn').nth(1);
    await day2Btn.click();
    
    // Clicking a day in debug mode should set time to 10m before first activity
    // and thus trigger a notification immediately.
    await page.waitForTimeout(2000);

    const notifications = await page.evaluate(() => window.__notifications);
    expect(notifications.length).toBeGreaterThan(0);
    
    // Verify the URL was updated
    const url = await page.url();
    expect(url).toContain('date=2026-05-25'); // Day 2 is May 25
  });

  test('should trigger haptics on day selection', async ({ page }) => {
    await setupSpies(page);
    await page.goto('/?debug=1');
    await page.waitForSelector('.day-btn');
    await page.waitForTimeout(1000); 

    // Click Day 3
    const day3Btn = page.locator('.day-btn').nth(2);
    await day3Btn.click();
    
    await page.waitForTimeout(500);

    const vibrations = await page.evaluate(() => window.__vibrations);
    expect(vibrations.length).toBeGreaterThan(0);
    // Expect at least one 'light' pulse [15] for the index change
    expect(vibrations).toContainEqual([15]);
  });

});

declare global {
  interface Window {
    __notifications: { title: string; body: string; options?: NotificationOptions }[];
    __vibrations: (number | number[])[];
    showLocalNotification: (title: string, body: string) => Promise<void>;
  }
}
