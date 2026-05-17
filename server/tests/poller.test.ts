import { timeToMinutes, isSameDay, getNextEvent, getJapanTime } from '../src/poller';
import { ItineraryDay } from '../src/sheets';

describe('Poller Logic Tests', () => {

  describe('timeToMinutes', () => {
    it('should convert time string to minutes', () => {
      expect(timeToMinutes('00:00')).toBe(0);
      expect(timeToMinutes('01:30')).toBe(90);
      expect(timeToMinutes('14:45')).toBe(885);
    });
    it('should handle invalid strings', () => {
      expect(timeToMinutes('')).toBe(0);
      expect(timeToMinutes('invalid')).toBe(0);
    });
  });

  describe('isSameDay', () => {
    it('should correctly identify same dates', () => {
      const date1 = new Date('2026-05-24T12:00:00Z');
      expect(isSameDay('2026-05-24', date1)).toBe(true);
      expect(isSameDay('2026-05-25', date1)).toBe(false);
    });
  });

  describe('getNextEvent', () => {
    const mockDays: ItineraryDay[] = [
      {
        day: 1,
        date: '2026-05-24',
        activities: [
          { id: '1', date: '2026-05-24', time: '10:00', title: 'Breakfast', location: '', notes: '', category: 'event', type: 'food' },
          { id: '2', date: '2026-05-24', time: '14:00', title: 'Lunch', location: '', notes: '', category: 'event', type: 'food' }
        ]
      },
      {
        day: 2,
        date: '2026-05-25',
        activities: [
          { id: '3', date: '2026-05-25', time: '09:00', title: 'Train', location: '', notes: '', category: 'event', type: 'transport' }
        ]
      }
    ];

    it('should return null if no matching day found', () => {
      const result = getNextEvent(mockDays, new Date('2025-01-01T12:00:00Z'));
      expect(result).toBeNull();
    });

    it('should find the next event later today', () => {
      // 02:00 UTC is 11:00 AM Tokyo
      const current = new Date('2026-05-24T02:00:00Z');
      const result = getNextEvent(mockDays, current);
      expect(result).toEqual({ title: 'Lunch', minutes: 180, time: '14:00', category: 'event' });
    });

    it('should find the next event tomorrow if today is done', () => {
      // 06:00 UTC is 3:00 PM Tokyo
      const current = new Date('2026-05-24T06:00:00Z');
      const result = getNextEvent(mockDays, current);
      expect(result).toEqual({ title: 'Train', minutes: 1080, time: '09:00', category: 'event' });
    });

    it('should return null if it is the last day and all events passed', () => {
      // 06:00 UTC is 3:00 PM Tokyo on 5/25
      const current = new Date('2026-05-25T06:00:00Z');
      const result = getNextEvent(mockDays, current);
      expect(result).toBeNull();
    });
  });

  describe('getJapanTime Timezone Independence', () => {
    it('should return a valid Date representing the absolute current instant', () => {
      const now = getJapanTime();
      expect(now).toBeInstanceOf(Date);
      expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(1000);
    });
  });

});
