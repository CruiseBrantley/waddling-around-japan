import { test, expect } from '@playwright/test';

test.describe('Alerting and Notification System', () => {

  const mockItinerary = {
    title: "Test Itinerary",
    days: [
      {
        day: 1,
        date: "2026-05-24",
        activities: [
          { id: "1", date: "2026-05-24", time: "06:00", title: "Early Event", type: "other", notes: "", location: "", category: "" },
          { id: "2", date: "2026-05-24", time: "10:00", title: "Breakfast", type: "food", notes: "", location: "", category: "" },
          { id: "3", date: "2026-05-24", time: "19:00", title: "Dinner Yakiniku", type: "food", notes: "", location: "", category: "Dining", requiresReservation: true }
        ]
      }
    ]
  };

  test.beforeEach(async ({ page }) => {
    // Capture console logs for debugging
    page.on('console', msg => {
      if (msg.text().includes('DEBUG')) {
        console.log(`BROWSER: ${msg.text()}`);
      }
    });
    
    // Enable notification permission for the browser context
    await page.context().grantPermissions(['notifications']);
    
    // Mock the Network layer to handle itinerary and VAPID
    await page.route('**/spreadsheets/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sheets: [{
            data: [{
              rowData: [
                {}, {}, // Skip header padding
                { values: [{ formattedValue: 'Date' }, { formattedValue: 'Time' }, { formattedValue: 'Activity' }, { formattedValue: 'Location' }, { formattedValue: 'Category' }] },
                {}, // Skip spacer
                { values: [{ formattedValue: '2026-05-24' }, { formattedValue: '06:00' }, { formattedValue: 'Early Event' }, { formattedValue: 'Tokyo' }, { formattedValue: 'Sightseeing' }] },
                { values: [{ formattedValue: '2026-05-24' }, { formattedValue: '10:00' }, { formattedValue: 'Breakfast' }, { formattedValue: 'Tokyo' }, { formattedValue: 'Dining' }] },
                { values: [
                  { formattedValue: '2026-05-24' }, 
                  { formattedValue: '19:00' }, 
                  { 
                    formattedValue: 'Dinner Yakiniku', 
                    effectiveFormat: { backgroundColor: { red: 0.65, green: 0.11, blue: 0.0 } } 
                  }, 
                  { formattedValue: 'Tokyo' }, 
                  { formattedValue: 'Dining' }
                ] }
              ]
            }]
          }]
        })
      });
    });

    // Mock the subscription endpoint
    await page.route('**/subscribe', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
    });

    // Add initialization scripts to mock the environment BEFORE the page loads
    await page.addInitScript((mockItineraryJson) => {
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
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      });

      // --- Service Worker & Push Mock ---
      const mockRegistration = {
        pushManager: {
          getSubscription: async () => null,
          subscribe: async () => ({
            toJSON: () => ({ endpoint: 'https://mock.push.com/123' })
          })
        },
        showNotification: async () => {}
      };

      if (!(navigator as any).serviceWorker) {
        (navigator as any).serviceWorker = {};
      }

      Object.defineProperty(navigator.serviceWorker, 'ready', {
        get: () => Promise.resolve(mockRegistration),
        configurable: true
      });

      navigator.serviceWorker.getRegistration = async () => mockRegistration;
      navigator.serviceWorker.addEventListener = () => {};
      navigator.serviceWorker.removeEventListener = () => {};

      // Pre-fill cache
      localStorage.setItem('itinerary_cache', mockItineraryJson);

      // Mock VAPID key
      (window as any).VITE_VAPID_PUBLIC_KEY = 'BI6X_Qv9Q6Q_Qv9Q6Q_Qv9Q6Q_Qv9Q6Q_Qv9Q6Q_Qv9Q6Q_Qv9Q6Q_Qv9Q6Q_Qv9Q6Q_Qv9Q6Q_Qv9Q6Q';
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }, JSON.stringify(mockItinerary));

    await page.goto('/?date=2026-05-24T12:00:00'); 
    await page.waitForSelector('.activity-card');
  });

  test('should highlight events requiring a reservation', async ({ page }) => {
    const reservationCard = page.locator('.activity-card.is-reservation', { hasText: 'Dinner Yakiniku' }).first();
    await expect(reservationCard).toBeVisible();
    await expect(reservationCard.locator('.reservation-badge')).toContainText('RESERVATION REQUIRED');
  });

  test('should request push subscription when enabling notifications', async ({ page }) => {
    // Go to settings and enable
    await page.click('.settings-toggle-btn');
    await page.waitForSelector('.settings-modal');
    await page.waitForTimeout(500); // Wait for slide-up animation
    
    // Toggle the notification switch
    const toggle = page.locator('.settings-row', { hasText: 'Event Alerts' }).locator('.settings-toggle');
    await toggle.click({ force: true });

    // Verify the toggle becomes active
    await expect(toggle).toHaveClass(/active/, { timeout: 8000 });
  });

  test('should show correct progress on the event countdown pill', async ({ page }) => {
    // Set time to 2 minutes before event (05:58 for 06:00 event)
    await page.goto('/?date=2026-05-24T05:58:00');
    await page.waitForSelector('.upcoming-pill');

    const progressVal = await page.locator('.pill-progress-rect').evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.strokeDasharray;
    });

    console.log('DEBUG: Final Progress Check =', progressVal);
    expect(progressVal).toContain('40');
  });

  test('should align pulse and border directions', async ({ page }) => {
    await page.goto('/?date=2026-05-24T05:58:00');
    await page.waitForSelector('.upcoming-pill');

    const pillSvg = page.locator('.pill-progress-svg');
    await expect(pillSvg).not.toHaveClass(/ccw/);
    
    const animation = await page.locator('.pill-progress-pulse').evaluate(el => {
      const styles = window.getComputedStyle(el);
      return styles.animationName;
    });
    expect(animation).toBe('pulse-travel');
  });

});
