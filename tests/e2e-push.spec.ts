// Force the Node process to run in Japan Time timezone for date math consistency
process.env.TZ = 'Asia/Tokyo';

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Load the exact same CommonJS modules using require to share Node's module cache perfectly
const webPush = require('../server/node_modules/web-push');
const appPkg = require('../server/dist/app.js');
const pollerPkg = require('../server/dist/poller.js');
const sheetsPkg = require('../server/dist/sheets.js');

const { app, setSubscriptionsFile: setAppSubsFile } = appPkg;
const { pollAndNotify, setSubscriptionsFile: setPollerSubsFile } = pollerPkg;

// Configure Playwright browser context to run natively in Asia/Tokyo timezone
test.use({ timezoneId: 'Asia/Tokyo' });

// 1. Programmatically mock web-push in the Node process using the shared cache
let sentPushes: Array<{ subscription: unknown, payload: string }> = [];
webPush.sendNotification = async (sub: unknown, payload: unknown) => {
  sentPushes.push({ subscription: sub, payload: String(payload) });
  return {} as unknown as ReturnType<typeof webPush.sendNotification>;
};

// 2. Programmatically mock the Google Sheet parsing on the shared sheets module cache
sheetsPkg.fetchItinerary = async () => {
  return {
    title: "E2E Test Itinerary",
    days: [
      {
        day: 1,
        date: "2026-05-24",
        activities: [
          {
            id: "e2e-1",
            date: "2026-05-24",
            time: "10:00",
            title: "E2E Breakfast",
            location: "Tokyo",
            category: "Dining",
            type: "food",
            notes: ""
          }
        ]
      }
    ]
  };
};

test.describe('Full End-to-End Push Notification Flow', () => {
  let server: Server;
  let port: number;
  const TEST_SUBS_FILE = path.resolve('tests/test-subs-e2e.json');

  test.beforeAll(async () => {
    // Direct BOTH the Express server AND the Poller to use our temp test-only JSON database file
    setAppSubsFile(TEST_SUBS_FILE);
    setPollerSubsFile(TEST_SUBS_FILE);
    
    if (fs.existsSync(TEST_SUBS_FILE)) {
      fs.unlinkSync(TEST_SUBS_FILE);
    }
    
    // Start Express app on port 0 (dynamic random available port) to prevent EADDRINUSE conflicts
    server = app.listen(0);
    port = (server.address() as AddressInfo).port;
    console.log(`Test Express server started on dynamic port: ${port}`);
  });

  test.afterAll(async () => {
    server.close();
    if (fs.existsSync(TEST_SUBS_FILE)) {
      fs.unlinkSync(TEST_SUBS_FILE);
    }
  });

  test('should successfully execute the entire push notification, category mute, and unsubscribe flow', async ({ page }) => {
    // Clear mock state
    sentPushes = [];

    // Inject mock browser environment (permission & standalone mode)
    await page.addInitScript(() => {
      // Mock standalone mode via direct property
      Object.defineProperty(window.navigator, 'standalone', { value: true });
      
      // Mock window.matchMedia to return true for standalone query
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = (query) => {
        if (query.includes('display-mode: standalone') || query.includes('standalone')) {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => true
          } as unknown as MediaQueryList;
        }
        return originalMatchMedia ? originalMatchMedia(query) : {
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true
        } as unknown as MediaQueryList;
      };

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
              endpoint: 'https://mock-push-service.com/e2e-client',
              keys: { auth: 'mock-auth', p256dh: 'mock-p256dh' },
              toJSON: () => ({ endpoint: 'https://mock-push-service.com/e2e-client' })
            }),
            getSubscription: async () => ({
              endpoint: 'https://mock-push-service.com/e2e-client',
              unsubscribe: async () => true
            })
          }
        }),
        getRegistrations: async () => [],
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      Object.defineProperty(navigator, 'serviceWorker', { value: mockServiceWorker, writable: true });

      // Inject initial local storage itinerary cache to avoid fetch hang
      const clientMockItinerary = {
        title: "E2E Test Itinerary",
        days: [
          {
            day: 1,
            date: "2026-05-24",
            activities: [
              { id: "e2e-1", date: "2026-05-24", time: "10:00", title: "E2E Breakfast", type: "food", notes: "", location: "", category: "Dining" }
            ]
          }
        ]
      };
      localStorage.setItem('itinerary_cache', JSON.stringify(clientMockItinerary));
    });

    // Playwright route interception to mock external Google Sheets requests to resolve instantly
    await page.route('**/v4/spreadsheets/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sheets: [
            {
              data: [
                {
                  rowData: [
                    { values: [ { formattedValue: "Date" }, { formattedValue: "Time" }, { formattedValue: "Activity" }, { formattedValue: "Category" } ] },
                    { values: [ { formattedValue: "2026-05-24" }, { formattedValue: "10:00" }, { formattedValue: "E2E Breakfast" }, { formattedValue: "Dining" } ] }
                  ]
                }
              ]
            }
          ]
        })
      });
    });

    // Forward client push endpoints to our dynamic programmatic Express server
    await page.route('**/subscribe', async (route, request) => {
      const response = await page.request.post(`http://localhost:${port}/subscribe`, {
        data: request.postDataJSON() || {},
        headers: request.headers()
      });
      await route.fulfill({
        status: response.status(),
        contentType: 'application/json',
        body: await response.text()
      });
    });

    await page.route('**/unsubscribe', async (route, request) => {
      const response = await page.request.post(`http://localhost:${port}/unsubscribe`, {
        data: request.postDataJSON() || {},
        headers: request.headers()
      });
      await route.fulfill({
        status: response.status(),
        contentType: 'application/json',
        body: await response.text()
      });
    });

    // Load PWA
    await page.goto('/?date=2026-05-24T09:00:00');
    await page.waitForSelector('.activity-card');

    // 1. Open Settings Modal
    await page.click('.settings-toggle-btn');
    await page.waitForSelector('.settings-modal');

    // 2. Enable Developer Mode
    const devToggle = page.locator('.settings-row', { hasText: 'Developer Mode' }).locator('.settings-toggle');
    await devToggle.scrollIntoViewIfNeeded();
    await devToggle.click({ force: true });
    await expect(devToggle).toHaveClass(/active/);

    // 3. Set Mock Time (Date = 2026-05-24, Time = 09:50 — exactly 10 minutes before the 10:00 Breakfast)
    await page.fill('input[type="date"]', '2026-05-24');
    await page.fill('input[type="time"]', '09:50');
    await page.click('button:has-text("Apply Override")');

    // 4. Enable Event Alerts (Triggers Subscription and sends to our local dynamic Express server)
    const alertToggle = page.locator('button[aria-label="Toggle notifications"]');
    await alertToggle.scrollIntoViewIfNeeded();
    await alertToggle.click({ force: true });
    await expect(alertToggle).toHaveClass(/active/);

    // Verify subscription stored correctly
    await expect.poll(() => {
      if (!fs.existsSync(TEST_SUBS_FILE)) return false;
      const subs = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
      return subs.length > 0;
    }, { timeout: 5000 }).toBe(true);

    let storedSubs = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(storedSubs[0].isDev).toBe(true);
    expect(storedSubs[0].settings.timezone).toBe('Asia/Tokyo');

    // 5. Trigger a backend Polling Cycle programmatically — HEADS-UP ALERT
    await pollAndNotify();

    // Verify heads-up alert triggered
    expect(sentPushes.length).toBe(1);
    let pushObj = JSON.parse(sentPushes[0].payload);
    expect(pushObj.title).toBe('Upcoming: E2E Breakfast');
    expect(pushObj.body).toContain('Starting in 10 minutes');
    expect(pushObj.type).toBe('info');

    // 6. Test URGENT ALERT Flow
    // Update mock time to 09:59 (1 minute before Breakfast)
    await page.fill('input[type="time"]', '09:59');
    await page.click('button:has-text("Apply Override")');

    // Wait for subscription updated with the new offset
    const currentOffset = storedSubs[0].settings.debugOffset;
    await expect.poll(() => {
      const subs = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
      return subs[0].settings.debugOffset !== currentOffset;
    }, { timeout: 5000 }).toBe(true);

    // Trigger backend polling cycle again
    sentPushes = []; // Reset captures
    await pollAndNotify();

    // Verify urgent push notification triggered
    expect(sentPushes.length).toBe(1);
    pushObj = JSON.parse(sentPushes[0].payload);
    expect(pushObj.title).toBe('Starting Now: E2E Breakfast');
    expect(pushObj.body).toContain('Time to head out!');
    expect(pushObj.type).toBe('urgent');

    // Click the Dining category chip to mute Dining alerts (using force: true to bypass overlays)
    const diningChip = page.locator('button.category-chip:has-text("Dining")');
    await diningChip.scrollIntoViewIfNeeded();
    await diningChip.click({ force: true });
    
    await expect(diningChip).not.toHaveClass(/active/); // Verification chip is inactive

    // Wait for subscription to be updated with disabledCategories containing Dining
    await expect.poll(() => {
      const subs = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
      return subs[0].settings.disabledCategories?.includes('Dining') === true;
    }, { timeout: 5000 }).toBe(true);

    // Clear deduplication state for testing (simulating a fresh poll run or event)
    storedSubs = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    storedSubs[0].lastUrgentEvent = undefined;
    storedSubs[0].lastHeadsUpEvent = undefined;
    fs.writeFileSync(TEST_SUBS_FILE, JSON.stringify(storedSubs, null, 2), 'utf8');

    // Run poll again
    sentPushes = [];
    await pollAndNotify();

    // Assert that NO push was sent because Dining is muted!
    expect(sentPushes.length).toBe(0);

    // Unmute "Dining" to restore alerts
    await diningChip.click({ force: true });
    await expect(diningChip).toHaveClass(/active/);

    // Wait for subscription to clear disabledCategories
    await expect.poll(() => {
      const subs = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
      return subs[0].settings.disabledCategories?.includes('Dining') === false;
    }, { timeout: 5000 }).toBe(true);

    // Run poll again
    await pollAndNotify();

    // Assert push was successfully restored and sent
    expect(sentPushes.length).toBe(1);
    pushObj = JSON.parse(sentPushes[0].payload);
    expect(pushObj.title).toBe('Starting Now: E2E Breakfast');

    // 8. Test UNSUBSCRIBE Flow
    // Toggle Alerts Off
    await alertToggle.click({ force: true });
    await expect(alertToggle).not.toHaveClass(/active/);

    // Verify subscription removed from filesystem database
    await expect.poll(() => {
      if (!fs.existsSync(TEST_SUBS_FILE)) return true;
      const subs = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
      return subs.length === 0;
    }, { timeout: 5000 }).toBe(true);
  });
});
