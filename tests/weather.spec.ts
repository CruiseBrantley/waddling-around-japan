import { test, expect } from '@playwright/test';

// Define a robust, self-contained mock weather generator for deterministic E2E testing.
// This decouples the tests from the production simulated fallback which has been removed.
function getMockWeatherData(region: string, dateStr: string, currentTime: Date) {
  const isOsaka = region.toLowerCase() === 'osaka';
  const tempMin = isOsaka ? 63 : 60;
  const tempMax = isOsaka ? 81 : 78;
  const hour = currentTime.getHours();
  
  // Computes dynamic temperature based on high/low bounds and the current hour (diurnal curve)
  let factor = 0;
  if (hour >= 5 && hour < 15) {
    factor = Math.sin(((hour - 5) / 10) * (Math.PI / 2)) ** 2;
  } else {
    const normalizedHour = hour < 5 ? hour + 24 : hour;
    factor = Math.cos(((normalizedHour - 15) / 14) * (Math.PI / 2)) ** 2;
  }
  const currentTemp = Math.round(tempMin + (tempMax - tempMin) * factor);

  const hourly = Array.from({ length: 24 }, (_, h) => {
    let f = 0;
    if (h >= 5 && h < 15) {
      f = Math.sin(((h - 5) / 10) * (Math.PI / 2)) ** 2;
    } else {
      const nh = h < 5 ? h + 24 : h;
      f = Math.cos(((nh - 15) / 14) * (Math.PI / 2)) ** 2;
    }
    return {
      hour: h,
      temp: Math.round(tempMin + (tempMax - tempMin) * f),
      emoji: '☀️'
    };
  });

  return {
    region,
    tempMin,
    tempMax,
    condition: 'Sunny',
    emoji: '☀️',
    precipProb: 0,
    humidity: 50,
    windSpeed: 5,
    advisory: 'Perfect weather for exploring!',
    currentTemp,
    hourly
  };
}

test.describe('Weather Widget & AI Advisory Integration', () => {
  test.setTimeout(45000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('test_initialized')) {
        localStorage.clear();
        sessionStorage.setItem('test_initialized', 'true');
      }
      // Mock timezone
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Intl.DateTimeFormat as any).prototype.resolvedOptions = () => ({
        timeZone: 'Asia/Tokyo'
      });

      // Mock standalone mode
      Object.defineProperty(window.navigator, 'standalone', { value: true });

      // Inject clean mock itinerary cache representing varied destinations
      const mockItinerary = {
        title: "Japan Trip E2E Weather Test",
        days: [
          {
            day: 1,
            date: "Sun, 5/24/26",
            activities: [
              { id: "act1", date: "Sun, 5/24/26", time: "09:00", title: "Universal Studios Japan", type: "event", notes: "Super Nintendo World!", location: "Osaka", category: "Event" },
              { id: "act2", date: "Sun, 5/24/26", time: "14:00", title: "Dotonbori Street Food", type: "food", notes: "Takoyaki and Kushikatsu", location: "Osaka", category: "Food" }
            ]
          },
          {
            day: 5,
            date: "Thu, 5/28/26",
            activities: [
              { id: "act3", date: "Thu, 5/28/26", time: "10:00", title: "Fushimi Inari Shrine Hike", type: "event", notes: "Red torii gates", location: "Kyoto", category: "Event" }
            ]
          },
          {
            day: 10,
            date: "Tue, 6/2/26",
            activities: [
              { id: "act4", date: "Tue, 6/2/26", time: "11:00", title: "Mt. Fuji Summit & View", type: "event", notes: "Cold weather expected", location: "Mount Fuji", category: "Event" }
            ]
          }
        ]
      };
      if (!localStorage.getItem('itinerary_cache')) {
        localStorage.setItem('itinerary_cache', JSON.stringify(mockItinerary));
      }
      
      // Seed default settings only if not already present
      if (!localStorage.getItem('app_settings')) {
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
          ollamaUrl: 'http://sirian.ddns.net:11434',
          ollamaModel: 'gemma4:26b'
        };
        localStorage.setItem('app_settings', JSON.stringify(defaultSettings));
      }
    });

    // Mock dynamic regions endpoint
    await page.route('**/regions/bulk', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          regionsMap: {
            "Sun, 5/24/26": ["Osaka"],
            "Thu, 5/28/26": ["Kyoto"],
            "Tue, 6/2/26": ["Mount Fuji"]
          }
        })
      });
    });

    await page.route('**/weather?*', async route => {
      const url = new URL(route.request().url());
      const region = url.searchParams.get('region') || 'Tokyo';
      const date = url.searchParams.get('date') || '';
      const currentTimeStr = url.searchParams.get('currentTime');
      const currentTime = currentTimeStr ? new Date(currentTimeStr) : new Date();

      const weather = getMockWeatherData(region, date, currentTime);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(weather)
      });
    });

    await page.route('**/advisor*', async route => {
      const urlStr = route.request().url();
      if (!urlStr.includes('?')) {
        const dummyTime = new Date('2026-05-24T12:00:00Z');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cache: {
              "Sun, 5/24/26_Osaka": {
                content: null,
                weather: getMockWeatherData('Osaka', 'Sun, 5/24/26', dummyTime)
              },
              "Sun, 5/24/26": {
                content: null
              },
              "Thu, 5/28/26_Kyoto": {
                content: null,
                weather: getMockWeatherData('Kyoto', 'Thu, 5/28/26', dummyTime)
              },
              "Tue, 6/2/26_Mount Fuji": {
                content: null,
                weather: getMockWeatherData('Mount Fuji', 'Tue, 6/2/26', dummyTime)
              }
            }
          })
        });
      } else {
        await route.continue();
      }
    });
  });

  test('should render weather widget correctly with resolved regions', async ({ page }) => {
    await page.goto('/');
    
    // Check if the weather widget is mounted
    const widget = page.locator('.swipe-slide.active .day-weather-widget');
    await expect(widget).toBeVisible();
    
    // Verify resolved location is Osaka
    const locationName = page.locator('.swipe-slide.active .weather-region-name');
    await expect(locationName).toContainText('Osaka');

    // Expand the drawer
    await page.locator('.swipe-slide.active .weather-main-panel').click();
    
    // Verify Hourly Trend section appears
    await expect(page.locator('.swipe-slide.active .weather-subtitle')).toContainText('Hourly Trend');
    await expect(page.locator('.swipe-slide.active .weather-hourly-slider')).toBeVisible();
    await expect(page.locator('.swipe-slide.active .weather-metrics-grid')).toBeVisible();
  });

  test('should calculate diurnal temp curve correctly based on time travel overrides', async ({ page }) => {
    await page.goto('/');

    // Open settings and set time travel manual override to 3:00 PM peak diurnal temperature
    await page.locator('.settings-toggle-btn').click();
    await page.locator('.settings-dev-input[type="date"]').fill('2026-05-24');
    await page.locator('.settings-dev-input[type="time"]').fill('15:00');
    await page.locator('button:has-text("Apply Override")').click();
    
    // Close settings modal
    await page.locator('.close-modal').click();
    
    // Day 1 has Osaka weather: Low 63°F, High 81°F. Peak heat at 15:00 should hit High temp (81°F)
    const currentTemp = page.locator('.swipe-slide.active .weather-current-degree');
    await expect(currentTemp).toContainText('81°');

    // Now change time override to 05:00 AM (coldest point of diurnal curve)
    await page.locator('.settings-toggle-btn').click();
    await page.locator('.settings-dev-input[type="time"]').fill('05:00');
    await page.locator('button:has-text("Apply Override")').click();
    await page.locator('.close-modal').click();

    // Diurnal low is at 5 AM, which should hit Low temp (63°F)
    await expect(currentTemp).toContainText('63°');
  });

  test('should display fallback card when advisor note is a cache miss on the server', async ({ page }) => {
    // Intercept GET /advisor to return a cache miss (404 content: null)
    await page.route('**/advisor?*', async route => {
      const urlStr = route.request().url();
      const url = new URL(urlStr);
      const region = url.searchParams.get('region') || 'Osaka';
      const date = url.searchParams.get('date') || '';
      const currentTimeStr = url.searchParams.get('currentTime');
      const currentTime = currentTimeStr ? new Date(currentTimeStr) : new Date();
      const weather = getMockWeatherData(region, date, currentTime);

      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ content: null, weather })
      });
    });

    await page.goto('/');

    // Expand drawer
    await page.locator('.swipe-slide.active .weather-main-panel').click();

    // Verify the AI Advisor fallback card is displayed natively
    const disabledCard = page.locator('.swipe-slide.active .ai-disabled-card');
    await expect(disabledCard).toBeVisible();
    await expect(disabledCard).toContainText('Preparing daily tailored outfits');
  });

  test('should instantly render advisor from bulk cache load on mount', async ({ page }) => {
    let advisorFetchCount = 0;

    // Intercept GET /advisor to return a populated cache map for the bulk request
    await page.route('**/advisor*', async route => {
      const urlStr = route.request().url();
      
      // We only care about the bulk fetch
      if (!urlStr.includes('?')) {
        advisorFetchCount++;
        const weather = getMockWeatherData('Osaka', 'Sun, 5/24/26', new Date('2026-05-24T12:00:00Z'));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cache: {
              "Sun, 5/24/26_Osaka": {
                content: "Shared Group Insight: Another group member generated this note for Osaka. Have fun!",
                weather
              },
              "Sun, 5/24/26": {
                content: "Shared Group Insight: Another group member generated this note for Osaka. Have fun!"
              }
            }
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');

    // Expand drawer
    await page.locator('.swipe-slide.active .weather-main-panel').click();

    // Verify the AI Advisory Output is visible immediately on mount (since it was fetched in bulk on load)
    const renderedAdvisory = page.locator('.swipe-slide.active .ai-advisory-output');
    await expect(renderedAdvisory).toBeVisible();
    await expect(renderedAdvisory).toContainText('Shared Group Insight');

    expect(advisorFetchCount).toBeGreaterThan(0);
    const firstLoadCount = advisorFetchCount;

    // Swipe to another day instead of reloading, to confirm UI interactions don't trigger network requests
    await page.locator('.swipe-slide.active').dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: 300, clientY: 300 }] });
    await page.locator('.swipe-slide.active').dispatchEvent('touchmove', { touches: [{ identifier: 0, clientX: 100, clientY: 300 }] });
    await page.locator('.swipe-slide.active').dispatchEvent('touchend');
    
    // Give it time to snap
    await page.waitForTimeout(500);
    
    // We expect the swipe to NOT have triggered another bulk network fetch
    expect(advisorFetchCount).toBe(firstLoadCount);
  });

  test('should maintain hourly forecast slider scroll position and not truncate brief advisory when expanded', async ({ page }) => {
    await page.goto('/');

    // 1. Expand the weather widget
    const weatherPanel = page.locator('.swipe-slide.active .weather-main-panel');
    await weatherPanel.click();

    // 2. Verify that the brief advisory text is wrapped (white-space is normal) when expanded
    const briefAdv = page.locator('.swipe-slide.active .weather-brief-adv');
    await expect(briefAdv).toBeVisible();
    const whiteSpace = await briefAdv.evaluate((el) => window.getComputedStyle(el).whiteSpace);
    expect(whiteSpace).toBe('normal');

    // 3. Find the hourly slider container
    const slider = page.locator('.swipe-slide.active .weather-hourly-slider');
    await expect(slider).toBeVisible();

    // Wait for the initial 150ms auto-scroll centering layout effect to complete first
    await page.waitForTimeout(500);

    // 4. Scroll the hourly slider container horizontally to a manual offset (either 150px or 300px depending on where it centered)
    const initialScroll = await slider.evaluate((el) => el.scrollLeft);
    const targetScroll = Math.abs(initialScroll - 150) > 50 ? 150 : 300;

    await slider.evaluate((el, target) => {
      el.scrollLeft = target;
    }, targetScroll);

    // Verify it actually scrolled to the targetScroll offset
    let scrollLeft = await slider.evaluate((el) => el.scrollLeft);
    expect(Math.abs(scrollLeft - targetScroll)).toBeLessThan(10);

    // 5. Wait for 1.5 seconds to allow clock updates/ticks to happen (which occur once per second)
    await page.waitForTimeout(1500);

    // 6. Assert that the scrollLeft position remains stable and did not snap back
    scrollLeft = await slider.evaluate((el) => el.scrollLeft);
    expect(Math.abs(scrollLeft - targetScroll)).toBeLessThan(10);
  });
});
