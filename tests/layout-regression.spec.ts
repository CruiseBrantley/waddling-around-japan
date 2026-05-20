import { test, expect } from '@playwright/test';

test.describe('Layout Regression Tests (Desktop vs Mobile)', () => {

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
    // Standard setup with a large itinerary
    await page.route('**/spreadsheets/**', async route => {
      const mockData = {
        sheets: [{
          data: [{
            rowData: [
              {}, {}, // Padding
              { values: [{ formattedValue: 'Date' }, { formattedValue: 'Time' }, { formattedValue: 'Activity' }, { formattedValue: 'Location' }, { formattedValue: 'Category' }] },
              {}, // Spacer
              ...Array.from({ length: 100 }).map((_, i) => ({
                values: [
                  { formattedValue: `2026-05-${String((i % 30) + 1).padStart(2, '0')}` },
                  { formattedValue: '10:00' },
                  { formattedValue: `Event ${i + 1}` },
                  { formattedValue: 'Tokyo' },
                  { formattedValue: 'event' }
                ]
              }))
            ]
          }]
        }]
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockData) });
    });

    await page.goto('/?date=2026-05-01T10:00:00');
    await page.waitForSelector('.activity-card');
  });

  test('Desktop: Sidebar should be sticky or correctly positioned', async ({ page, isMobile }) => {
    if (isMobile) return;

    // 1. Verify alignment (Centering)
    const mainLayout = page.locator('.main-layout');
    const layoutBox = await mainLayout.boundingBox();
    const viewportWidth = page.viewportSize()?.width || 0;
    
    if (layoutBox && viewportWidth > 0) {
      const leftGap = layoutBox.x;
      const rightGap = viewportWidth - (layoutBox.x + layoutBox.width);
      // Allow for a small difference (1-2px) but definitely not 131px
      console.log(`Desktop Alignment check: LeftGap=${leftGap}, RightGap=${rightGap}`);
      expect(Math.abs(leftGap - rightGap)).toBeLessThan(10);
    }

    // 2. Verify sidebar buttons visibility
    const settingsBtn = page.locator('.settings-toggle-btn');
    await expect(settingsBtn).toBeVisible();
    const opacity = await settingsBtn.evaluate(el => window.getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeGreaterThan(0.3);

    // 3. Verify highlight synchronization
    // Scroll the main column to Day 10 (index 9)
    // We scroll so the top of Day 10 is at the top of the container
    const slide10 = page.locator('.swipe-slide[data-index="9"]');
    await slide10.evaluate(el => {
      const container = el.closest('.swipe-container-outer');
      if (container) container.scrollTo({ top: (el as HTMLElement).offsetTop - 20 });
    });
    
    const activeBtn = page.locator('.day-btn.is-active');

    // 4. Verify the active button is visible in the sidebar viewport
    const isWithinViewport = await activeBtn.evaluate((el) => {
      const parent = el.closest('.sidebar');
      if (!parent) return false;
      const rect = el.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      return (
        rect.top >= parentRect.top &&
        rect.bottom <= parentRect.bottom
      );
    });
    expect(isWithinViewport).toBe(true);
  });

  test('Mobile: DaySelector should be sticky at the top', async ({ page, isMobile }) => {
    if (!isMobile) return;

    const daySelector = page.locator('.day-selector');
    await expect(daySelector).toBeVisible();

    // Scroll down the page
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.waitForTimeout(500);

    // DaySelector should still be at the top of the viewport (sticky)
    const top = await daySelector.evaluate(el => el.getBoundingClientRect().top);
    // Allow for small offset due to safe areas (up to ~60px on iOS) or 1px borders
    expect(top).toBeLessThanOrEqual(60); 
    expect(top).toBeGreaterThanOrEqual(-5);
  });

});
