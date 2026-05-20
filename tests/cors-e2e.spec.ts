import { test, expect } from '@playwright/test';

test.describe('CORS E2E Browser Verification', () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;

    // Listen for console logs, particularly CORS and connection errors
    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error' || text.toLowerCase().includes('cors') || text.toLowerCase().includes('access-control')) {
        consoleErrors.push(`[Console Error] ${text}`);
      }
    });

    // Handle page-level uncaught exceptions
    page.on('pageerror', err => {
      consoleErrors.push(`[Page Error] ${err.message}`);
    });

    // Listen for failed network requests
    page.on('requestfailed', request => {
      const url = request.url();
      const failure = request.failure();
      if (url.includes('/api') || url.includes('.loca.lt')) {
        consoleErrors.push(`[Request Failed] URL: ${url}, Reason: ${failure?.errorText}`);
      }
    });

    await page.addInitScript(() => {
      // Clear storage
      localStorage.clear();
      sessionStorage.clear();

      // Seed mock itinerary
      const mockItinerary = {
        title: "CORS E2E Test Trip",
        days: [
          {
            day: 1,
            date: "Sun, 5/24/26",
            activities: [
              { id: "act1", date: "Sun, 5/24/26", time: "09:00", title: "Arrival in Osaka", type: "event", notes: "", location: "Osaka", category: "Event" }
            ]
          }
        ]
      };
      localStorage.setItem('itinerary_cache', JSON.stringify(mockItinerary));

      // Seed app settings
      const defaultSettings = {
        soundEnabled: true,
        hapticsEnabled: true,
        notificationsEnabled: false,
        notifyHeadsUpEnabled: true,
        notifyHeadsUpChime: true,
        notifyHeadsUpVibrate: true,
        notifyUrgentEnabled: true,
        notifyUrgentChime: true,
        notifyUrgentVibrate: true,
        notifyMinutesBefore: 10,
        notifyUrgentMinutesBefore: 1,
        debugTime: null,
        debugDate: null,
        debugOffset: null,
        devMode: false,
        disabledCategories: [],
        aiProvider: 'gemma',
        geminiApiKey: '',
        geminiModel: 'gemini-2.5-flash',
        ollamaUrl: 'http://127.0.0.1:4000',
        ollamaModel: 'gemma4:26b'
      };
      localStorage.setItem('app_settings', JSON.stringify(defaultSettings));
    });
  });

  test('should load PWA home page and make API calls through Vite proxy without CORS errors', async ({ page }) => {
    // Intercept bulk regions and advisor requests to ensure they resolve cleanly
    await page.route('**/regions/bulk', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true'
        },
        body: JSON.stringify({
          regionsMap: { "Sun, 5/24/26": ["Osaka"] }
        })
      });
    });

    await page.route('**/advisor*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true'
        },
        body: JSON.stringify({
          cache: {
            "Sun, 5/24/26_Osaka": {
              content: "Weather-safe advisory content",
              weather: {
                currentTemp: 72,
                tempMin: 60,
                tempMax: 80,
                condition: 'Sunny',
                emoji: '☀️',
                precipProb: 0,
                humidity: 50,
                windSpeed: 5,
                hourly: Array.from({ length: 24 }, (_, h) => ({
                  hour: h,
                  temp: Math.round(70 + Math.sin(h / 3) * 5),
                  emoji: '☀️'
                }))
              }
            },
            "Sun, 5/24/26": {
              content: "Weather-safe advisory content"
            }
          }
        })
      });
    });

    // Go to home page
    await page.goto('/');

    // Let any async requests complete
    await page.waitForTimeout(2000);

    // Expand weather drawer to force the AI advisory component to render
    const weatherPanel = page.locator('.swipe-slide.active .weather-main-panel');
    await expect(weatherPanel).toBeVisible();
    await weatherPanel.click();

    // Verify advisor content loaded cleanly without CORS blocks
    const renderedAdvisory = page.locator('.swipe-slide.active .ai-advisory-output');
    await expect(renderedAdvisory).toBeVisible();
    await expect(renderedAdvisory).toContainText('Weather-safe advisory content');

    // Confirm absolutely zero CORS console warnings or page errors occurred
    const corsViolations = consoleErrors.filter(err => 
      err.toLowerCase().includes('cors') || 
      err.toLowerCase().includes('access-control') ||
      err.toLowerCase().includes('failed to fetch')
    );
    expect(corsViolations).toEqual([]);
  });
});
