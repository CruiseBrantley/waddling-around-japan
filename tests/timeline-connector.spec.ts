import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

/**
 * TDD: Timeline connector must not overflow past the bottom edge of its card.
 *
 * The connector lives in .timeline-left (flex child of .timeline-item).
 * It uses flex:1 to grow downward from the dot. If it bleeds past the card
 * boundary, the bottom of .timeline-left will exceed the bottom of .activity-card.
 */
test.describe('Timeline connector overflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Inject a grouped session so we get sub-items with connectors
      const mockItinerary = {
        title: 'Connector Test',
        days: [
          {
            day: 1,
            date: '2026-05-24',
            activities: [
              { id: 'a1', time: '10:00', title: 'Group Header', category: 'Event', location: 'Loc A', notes: '' },
              { id: 'a2', time: '',      title: 'Sub Item 1',   category: 'Food',  location: 'Loc B', notes: '' },
              { id: 'a3', time: '',      title: 'Sub Item 2',   category: 'Food',  location: 'Loc C', notes: '' },
              { id: 'a4', time: '14:00', title: 'Next Session', category: 'Event', location: 'Loc D', notes: '' },
            ],
          },
        ],
      };
      localStorage.setItem('itinerary_cache', JSON.stringify(mockItinerary));
    });
    await page.goto('/?date=2026-05-24T09:00:00');
    await page.waitForSelector('.timeline-item');
  });

  test('connector bottom must not exceed card bottom on any timeline item', async ({ page }) => {
    const violations = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.timeline-item'));
      const bad: { index: number; leftBottom: number; cardBottom: number; overflow: number }[] = [];

      items.forEach((item, i) => {
        const left = item.querySelector('.timeline-left') as HTMLElement | null;
        const card = item.querySelector('.activity-card') as HTMLElement | null;
        if (!left || !card) return;

        const leftRect = left.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();

        // Allow 1px rounding tolerance
        const overflow = leftRect.bottom - cardRect.bottom;
        if (overflow > 1) {
          bad.push({ index: i, leftBottom: leftRect.bottom, cardBottom: cardRect.bottom, overflow });
        }
      });
      return bad;
    });

    // RED phase: this will show which items overflow before the fix
    console.log('Overflow violations:', violations);
    expect(violations, `Connector overflows card on items: ${JSON.stringify(violations)}`).toHaveLength(0);
  });
});
