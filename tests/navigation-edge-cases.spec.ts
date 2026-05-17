import { test, expect } from '@playwright/test';

test.describe('Navigation Edge Cases', () => {

  const mockItineraryData = {
    sheets: [{
      data: [{
        rowData: [
          { values: [{ formattedValue: 'Date' }, { formattedValue: 'Time' }, { formattedValue: 'Activity' }, { formattedValue: 'Location' }, { formattedValue: 'Category' }] },
          // Day 1: May 24
          { values: [{ formattedValue: '2026-05-24' }, { formattedValue: '09:00' }, { formattedValue: 'D1 Morning' }, { formattedValue: 'Tokyo' }, { formattedValue: 'Sightseeing' }] },
          // Day 8: May 31 (The User's Target Day)
          { values: [{ formattedValue: '2026-05-31' }, { formattedValue: '09:00' }, { formattedValue: 'D8 Morning' }, { formattedValue: 'Tokyo' }, { formattedValue: 'Sightseeing' }] },
          { values: [{ formattedValue: '2026-05-31' }, { formattedValue: '15:45' }, { formattedValue: 'Target Event' }, { formattedValue: 'Tokyo' }, { formattedValue: 'Sightseeing' }] },
          { values: [{ formattedValue: '2026-05-31' }, { formattedValue: '15:45' }, { formattedValue: 'Same Time Event' }, { formattedValue: 'Tokyo' }, { formattedValue: 'Sightseeing' }] },
          { values: [{ formattedValue: '2026-05-31' }, { formattedValue: '18:00' }, { formattedValue: 'D8 Evening' }, { formattedValue: 'Tokyo' }, { formattedValue: 'Dining' }] },
        ]
      }]
    }]
  };

  test.beforeEach(async ({ page }) => {
    await page.route('**/spreadsheets/**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockItineraryData) });
    });
  });

  test('User Edge Case: 3:47 PM on May 31 (Post-start of 3:45 PM event)', async ({ page }) => {
    // 15:47 is 2 minutes after 15:45
    await page.goto('/?date=2026-05-31T15:47:00');
    await page.waitForSelector('.activity-card');
    
    // Give time for jump
    await page.waitForTimeout(2000);

    const liveCard = page.locator('.activity-card.is-live');
    await expect(liveCard).toContainText('Target Event');
    
    // Verify positioning (15% down the screen below header)
    await expect.poll(async () => {
      return await liveCard.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const headerHeight = 96;
        const expectedTop = headerHeight + (window.innerHeight * 0.15);
        // On mobile it might be tighter, but we check if it's generally in the upper viewport area
        return Math.abs(rect.top - expectedTop) < 100;
      });
    }, { timeout: 5000 }).toBe(true);

    // Verify Pill says NEXT (not LIVE NOW)
    const pill = page.locator('.upcoming-pill');
    await expect(pill).toContainText('NEXT: D8 Evening');
  });

  test('Strict Timing: Exactly at start time (3:45 PM)', async ({ page }) => {
    await page.goto('/?date=2026-05-31T15:45:00');
    await page.waitForSelector('.activity-card');
    
    await page.waitForTimeout(2000);

    const liveCard = page.locator('.activity-card.is-live');
    await expect(liveCard).toContainText('Target Event');
    
    const pill = page.locator('.upcoming-pill');
    await expect(pill).toContainText('NEXT: D8 Evening');
  });

  test('Strict Timing: 1 minute before event (3:44 PM) - Should NOT be live', async ({ page }) => {
    await page.goto('/?date=2026-05-31T15:44:00');
    await page.waitForSelector('.activity-card');
    
    await page.waitForTimeout(2000);

    const noLiveCard = page.locator('.activity-card.is-live');
    await expect(noLiveCard).toHaveCount(0);
    
    const pill = page.locator('.upcoming-pill');
    await expect(pill).toContainText('NEXT: Target Event');
  });

  test('Buffer Case: 2 minutes before event (3:43 PM for 3:45 PM event) - Should NOT be live', async ({ page }) => {
    await page.goto('/?date=2026-05-31T15:43:00');
    await page.waitForSelector('.activity-card');
    
    await page.waitForTimeout(2000);

    // Live card should be null since it's the gap between morning and 3:45
    const noLiveCard = page.locator('.activity-card.is-live');
    await expect(noLiveCard).toHaveCount(0);
    
    // Pill should say "NEXT" because 3:43 is 2 mins before 3:45
    const pill = page.locator('.upcoming-pill');
    await expect(pill).toContainText('NEXT: Target Event');
  });

  test('Conflict Case: Multiple events at same time (15:45) - Should pick the first one', async ({ page }) => {
    await page.goto('/?date=2026-05-31T15:45:00');
    await page.waitForSelector('.activity-card');
    
    await page.waitForTimeout(2000);

    const liveCard = page.locator('.activity-card.is-live');
    await expect(liveCard).toContainText('Target Event');
  });

  test('End of Day Case: Last event (18:00) - Should stay live for 150 minutes', async ({ page }) => {
    // 18:00 + 120 mins = 20:00
    await page.goto('/?date=2026-05-31T20:00:00');
    await page.waitForSelector('.activity-card');
    
    await page.waitForTimeout(2000);

    const liveCard = page.locator('.activity-card.is-live');
    await expect(liveCard).toContainText('D8 Evening');
    
    // 18:00 + 151 mins = 20:31 -> Should no longer be live
    await page.goto('/?date=2026-05-31T20:31:00');
    await page.waitForTimeout(1000);
    const noLiveCard = page.locator('.activity-card.is-live');
    await expect(noLiveCard).toHaveCount(0);
  });
});
