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
          { id: '1', date: '2026-05-24', time: '10:00', title: 'Breakfast', category: 'event', type: 'food' }
        ]
      }
    ]
  };

  it('should respect per-user thresholds (heads-up)', async () => {
    // 1. Setup itinerary
    (sheets.fetchItinerary as jest.Mock).mockResolvedValue(mockItinerary);

    // 2. Setup Japan time to 09:48 (12 mins before event)
    // 00:48 UTC is 09:48 AM Tokyo
    const japanTime = new Date('2026-05-24T00:48:00Z');
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
      expect.stringContaining('Upcoming: Breakfast'),
      expect.objectContaining({ urgency: 'high', TTL: 3600 })
    );
  });

  it('should deduplicate notifications per user', async () => {
    (sheets.fetchItinerary as jest.Mock).mockResolvedValue(mockItinerary);
    // 00:55 UTC is 09:55 AM Tokyo
    const japanTime = new Date('2026-05-24T00:55:00Z');
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
    // 00:59:30 UTC is 09:59:30 AM Tokyo
    const japanTime = new Date('2026-05-24T00:59:30Z');
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
      expect.stringContaining('Starting Now: Breakfast'),
      expect.objectContaining({ urgency: 'high', TTL: 3600 })
    );

    // Verify file updated with lastUrgentEvent
    const updated = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(updated[0].lastUrgentEvent).toBe('Breakfast-10:00');
  });

  it('should support dynamic multi-timezone evaluation per-user', async () => {
    (sheets.fetchItinerary as jest.Mock).mockResolvedValue(mockItinerary);
    
    // Server absolute time is 2026-05-24T00:50:00Z.
    // - In Asia/Tokyo, this is 09:50 AM. This is exactly 10 minutes before the 10:00 AM breakfast on May 24th.
    // - In America/Chicago, this is 07:50 PM on the previous day (May 23rd).
    const serverTime = new Date('2026-05-24T00:50:00Z');
    jest.spyOn(poller, 'getJapanTime').mockReturnValue(serverTime);

    const subs = [
      {
        subscription: { endpoint: 'tokyo-user' },
        settings: { 
          notifyMinutesBefore: 10, 
          notifyUrgentMinutesBefore: 1,
          timezone: 'Asia/Tokyo' 
        }
      },
      {
        subscription: { endpoint: 'chicago-user' },
        settings: { 
          notifyMinutesBefore: 10, 
          notifyUrgentMinutesBefore: 1,
          timezone: 'America/Chicago' 
        }
      }
    ];
    fs.writeFileSync(TEST_SUBS_FILE, JSON.stringify(subs));

    await pollAndNotify();

    // Tokyo user should receive notification (since they are 10m away from Breakfast on 5/24)
    expect(webPush.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'tokyo-user' }),
      expect.stringContaining('Upcoming: Breakfast'),
      expect.objectContaining({ urgency: 'high', TTL: 3600 })
    );

    // Chicago user should NOT receive notification (it is still 5/23 for them, and it is 7:50 PM, completely different day/time)
    expect(webPush.sendNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'chicago-user' }),
      expect.any(String)
    );
  });

  it('should apply client settings debugOffset for dev subscriptions', async () => {
    (sheets.fetchItinerary as jest.Mock).mockResolvedValue(mockItinerary);
    
    // Server time is 2026-05-20 (a few days before May 24th Breakfast)
    const serverTime = new Date('2026-05-20T00:00:00Z');
    jest.spyOn(poller, 'getJapanTime').mockReturnValue(serverTime);

    // 4 days offset is 4 * 24 * 60 * 60 * 1000 = 345600000 milliseconds
    // Tokyo time on 5/20 at 00:00:00Z is 09:00:00 AM Tokyo time.
    // 4 days forward is May 24th 09:00 AM.
    // We add another 50 minutes to mock it to 09:50 AM Tokyo time (10 minutes before Breakfast).
    const debugOffset = (4 * 24 * 60 * 60 * 1000) + (50 * 60 * 1000);

    const subs = [
      {
        subscription: { endpoint: 'dev-user-mock' },
        settings: { 
          notifyMinutesBefore: 10, 
          notifyUrgentMinutesBefore: 1,
          timezone: 'Asia/Tokyo',
          debugOffset
        },
        isDev: true
      }
    ];
    fs.writeFileSync(TEST_SUBS_FILE, JSON.stringify(subs));

    await pollAndNotify();

    // Dev user should receive the notification even though the server is at May 20th!
    expect(webPush.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'dev-user-mock' }),
      expect.stringContaining('Upcoming: Breakfast'),
      expect.objectContaining({ urgency: 'high', TTL: 3600 })
    );
  });
});
