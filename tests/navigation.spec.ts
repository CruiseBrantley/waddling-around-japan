import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

test.describe('Navigation Jumps', () => {
  test.beforeEach(async ({ page }) => {
    // Forward browser console logs to CLI output
    page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));

    // Mock PWA environment
    await page.addInitScript(() => {
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
      
      // Intercept fetch calls to prevent real network hits and force local cache fallback
      const originalFetch = window.fetch;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.fetch = async (...args: any[]) => {
        const [url] = args;
        const urlStr = typeof url === 'string' ? url : (url as unknown as Request).url;
        if (urlStr.includes('sheets.googleapis.com')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ok: false, status: 404, statusText: 'Mocked Sheets Error for Test Isolation' } as any;
        }
        return originalFetch(...args);
      };

      // Mock many activities for Day 1
      const activities = [];
      for (let i = 0; i < 50; i++) {
        const hour = 8 + Math.floor(i / 2);
        const min = (i % 2) * 30;
        activities.push({
          id: `act-${i}`,
          time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
          title: `Activity ${i}`,
          category: 'sightseeing',
          location: 'Location',
          notes: 'Notes'
        });
      }

      const mockItinerary = {
        title: "Test Itinerary",
        days: [
          { day: 1, date: "2026-05-24", activities },
          { day: 2, date: "2026-05-25", activities: [
            { id: "day2-1", time: "09:00", title: "Day 2 Activity", category: "food", location: "Loc", notes: "N" }
          ]}
        ]
      };
      localStorage.setItem('itinerary_cache', JSON.stringify(mockItinerary));
    });

    await page.goto('/');
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
