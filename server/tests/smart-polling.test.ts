import * as poller from '../src/poller';
const { pollAndNotify, setSubscriptionsFile } = poller;
import * as sheets from '../src/sheets';
import webPush from 'web-push';
import fs from 'fs';
import path from 'path';

jest.mock('../src/sheets');
jest.mock('web-push');

describe('Smart Polling Tests', () => {
  const TEST_SUBS_FILE = path.join(__dirname, 'test-subs.json');
  
  beforeAll(() => {
    setSubscriptionsFile(TEST_SUBS_FILE);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_SUBS_FILE)) {
      fs.unlinkSync(TEST_SUBS_FILE);
    }
    jest.clearAllMocks();
  });

  const mockItinerary = {
    days: [
      {
        day: 1,
        date: '2026-05-24', // We will simulate Japan time as this date
        activities: [
          { id: '1', date: '2026-05-24', time: '10:00', title: 'Breakfast' }
        ]
      }
    ]
  };

  it('should respect per-user thresholds (heads-up)', async () => {
    // 1. Setup itinerary
    (sheets.fetchItinerary as jest.Mock).mockResolvedValue(mockItinerary);

    // 2. Setup Japan time to 09:48 (12 mins before event)
    const japanTime = new Date('2026-05-24T09:48:00');
    // We mock the Date.toLocaleString or the getJapanTime helper. 
    // Since getJapanTime uses toLocaleString, we can mock it.
    jest.spyOn(poller, 'getJapanTime').mockReturnValue(japanTime);

    // 3. Setup subscriptions: User A (15m heads up), User B (10m heads up)
    const subs = [
      {
        subscription: { endpoint: 'user-a' },
        settings: { notifyMinutesBefore: 15, notifyUrgentMinutesBefore: 1 }
      },
      {
        subscription: { endpoint: 'user-b' },
        settings: { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1 }
      }
    ];
    fs.writeFileSync(TEST_SUBS_FILE, JSON.stringify(subs));

    // 4. Run poller
    await pollAndNotify();

    // 5. Verify: Only User A should get a push (since 12 < 15, but 12 > 10)
    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    expect(webPush.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'user-a' }),
      expect.stringContaining('Upcoming: Breakfast')
    );
  });

  it('should deduplicate notifications per user', async () => {
    (sheets.fetchItinerary as jest.Mock).mockResolvedValue(mockItinerary);
    const japanTime = new Date('2026-05-24T09:55:00'); // 5 mins before
    jest.spyOn(poller, 'getJapanTime').mockReturnValue(japanTime);

    // User already notified for this event
    const subs = [
      {
        subscription: { endpoint: 'user-a' },
        settings: { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1 },
        lastHeadsUpEvent: 'Breakfast-10:00'
      }
    ];
    fs.writeFileSync(TEST_SUBS_FILE, JSON.stringify(subs));

    await pollAndNotify();

    // Should NOT call sendNotification again
    expect(webPush.sendNotification).not.toHaveBeenCalled();
  });

  it('should send urgent notification and track it separately', async () => {
    (sheets.fetchItinerary as jest.Mock).mockResolvedValue(mockItinerary);
    const japanTime = new Date('2026-05-24T09:59:30'); // 30 secs before
    jest.spyOn(poller, 'getJapanTime').mockReturnValue(japanTime);

    const subs = [
      {
        subscription: { endpoint: 'user-a' },
        settings: { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1 },
        lastHeadsUpEvent: 'Breakfast-10:00'
      }
    ];
    fs.writeFileSync(TEST_SUBS_FILE, JSON.stringify(subs));

    await pollAndNotify();

    // Should send URGENT push
    expect(webPush.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'user-a' }),
      expect.stringContaining('Starting Now: Breakfast')
    );

    // Verify file updated with lastUrgentEvent
    const updated = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(updated[0].lastUrgentEvent).toBe('Breakfast-10:00');
  });
});
