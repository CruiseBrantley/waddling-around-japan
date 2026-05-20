import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

// Dynamically construct raw Sheets rows to prevent local storage race conditions
const buildMockItineraryRows = () => {
  const headers = [
    { formattedValue: 'Date' },
    { formattedValue: 'Time' },
    { formattedValue: 'Activity' },
    { formattedValue: 'Location' },
    { formattedValue: 'Category' },
    { formattedValue: 'Notes' }
  ];
  
  const rows = [{ values: headers }];
  
  // Day 1 (May 24, 2026): 50 activities for centering testing
  for (let i = 0; i < 50; i++) {
    const hour = 8 + Math.floor(i / 2);
    const min = (i % 2) * 30;
    rows.push({
      values: [
        { formattedValue: 'Sun, 5/24/26' },
        { formattedValue: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}` },
        { formattedValue: `Activity ${i}` },
        { formattedValue: 'Location' },
        { formattedValue: 'Sightseeing' },
        { formattedValue: 'Notes' }
      ]
    });
  }

  // Day 2 (May 25, 2026): 1 activity
  rows.push({
    values: [
      { formattedValue: 'Mon, 5/25/26' },
      { formattedValue: '09:00' },
      { formattedValue: 'Day 2 Activity' },
      { formattedValue: 'Loc' },
      { formattedValue: 'Food' },
      { formattedValue: 'N' }
    ]
  });

  return {
    sheets: [{
      data: [{
        rowData: rows
      }]
    }]
  };
};

const mockItineraryData = buildMockItineraryRows();

test.describe('Navigation Jumps', () => {
  test.beforeEach(async ({ page }) => {
    // Forward browser console logs to CLI output
    page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));

    // Intercept Google Sheets API calls and fulfill with status 200
    await page.route('**/spreadsheets/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockItineraryData)
      });
    });

    // Intercept regions bulk endpoint to avoid hitting local Express server
    await page.route('**/regions/bulk', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ regionsMap: {} })
      });
    });

    // Intercept weather endpoint to prevent real network hits
    await page.route('**/weather?*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          region: 'Tokyo',
          tempMin: 65,
          tempMax: 78,
          condition: 'Sunny',
          emoji: '☀️',
          precipProb: 10,
          humidity: 60,
          windSpeed: 5,
          advisory: 'Enjoy your day in Tokyo!',
          currentTemp: 72,
          hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, temp: 70, emoji: '☀️' }))
        })
      });
    });

    // Intercept AI travel advisor endpoint to prevent real network hits
    await page.route('**/advisor*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: 'Tokyo weather is perfect today.',
          weather: {
            region: 'Tokyo',
            tempMin: 65,
            tempMax: 78,
            condition: 'Sunny',
            emoji: '☀️',
            precipProb: 10,
            humidity: 60,
            windSpeed: 5,
            advisory: 'Enjoy your day in Tokyo!',
            currentTemp: 72,
            hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, temp: 70, emoji: '☀️' }))
          }
        })
      });
    });

    // Mock PWA environment & browser features
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('test_initialized')) {
        localStorage.clear();
        sessionStorage.setItem('test_initialized', 'true');
      }

      // Force Asia/Tokyo timezone
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Intl.DateTimeFormat as any).prototype.resolvedOptions = () => ({
        timeZone: 'Asia/Tokyo'
      });

      Object.defineProperty(window.navigator, 'standalone', { value: true });
      (window as Window & { IS_TESTING: boolean }).IS_TESTING = true;
      
      // Force instant scroll and remove safe areas for deterministic testing
      const style = document.createElement('style');
      style.textContent = `
        html, body, .swipe-container-outer, .day-scroll-container { 
          scroll-behavior: auto !important; 
          scroll-snap-type: none !important;
        }
        :root { --safe-area-top: 0px !important; --safe-area-bottom: 0px !important; }
      `;
      document.head.appendChild(style);
    });
  });

  test('should center the live activity correctly on a long day', async ({ page }) => {
    // 1. Mock time via URL and reload
    await page.goto('/?date=2026-05-24T13:15:00');
    await page.waitForSelector('.activity-card');

    // 2. Scroll away to ensure the pill appears
    await page.evaluate(() => window.scrollTo(0, 5000));
    
    // 3. Click the "Next Activity" pill
    const livePill = page.locator('.upcoming-pill');
    await expect(livePill).toBeVisible();
    await livePill.click();

    // 3. Wait for scroll to settle
    await page.waitForTimeout(1000);

    // 4. Verify centering
    const liveCard = page.locator('.activity-card.is-live');
    const box = await liveCard.boundingBox();
    const viewport = page.viewportSize();
    const daySelector = page.locator('.day-selector');
    const headerBox = await daySelector.boundingBox();

    if (box && viewport && headerBox) {
      const expectedTop = headerBox.height + (viewport.height * 0.15);
      
      // Allow for small margin of error (smooth scroll might be slightly off)
      expect(Math.abs(box.y - expectedTop)).toBeLessThan(50);
    }
  });

  test('should jump and center activity on a different day', async ({ page }) => {
    // 1. Open app mocked to Day 1 morning (Activity 0 is live)
    await page.goto('/?date=2026-05-24T08:00:00');
    await page.waitForSelector('.activity-card');
    
    // Wait for initial jump timeout to fire and settle
    await page.waitForTimeout(500);
    
    // 2. Manually navigate to Day 2
    await page.locator('.day-btn').nth(1).click();
    
    // 3. Verify we are on Day 2
    await expect(page.locator('.swipe-slide.active')).toHaveAttribute('data-index', '1');

    // 4. Click "Jump to Now" (which is actually the upcoming pill when an event exists)
    await page.click('.upcoming-pill');
    
    // 5. Wait for jump and verify Day 1
    await page.waitForTimeout(1500);
    const activeSlide = page.locator('.swipe-slide.active');
    await expect(activeSlide).toHaveAttribute('data-index', '0');
    
    const liveCard = page.locator('.activity-card.is-live');
    const box = await liveCard.boundingBox();
    const viewport = page.viewportSize();
    const headerBox = await page.locator('.day-selector').boundingBox();

    if (box && viewport && headerBox) {
      const expectedTop = headerBox.height + (viewport.height * 0.15);
      expect(Math.abs(box.y - expectedTop)).toBeLessThan(50);
    }
  });
});
