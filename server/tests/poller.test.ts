import { timeToMinutes, isSameDay, getNextEvent } from '../src/poller';
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
          { id: '1', date: '2026-05-24', time: '10:00', title: 'Breakfast', location: '', notes: '', category: '', type: 'food' },
          { id: '2', date: '2026-05-24', time: '14:00', title: 'Lunch', location: '', notes: '', category: '', type: 'food' }
        ]
      },
      {
        day: 2,
        date: '2026-05-25',
        activities: [
          { id: '3', date: '2026-05-25', time: '09:00', title: 'Train', location: '', notes: '', category: '', type: 'transport' }
        ]
      }
    ];

    it('should return null if no matching day found', () => {
      const result = getNextEvent(mockDays, new Date('2025-01-01T12:00:00Z'));
      expect(result).toBeNull();
    });

    it('should find the next event later today', () => {
      // Current time: 11:00 on May 24. Next event is Lunch at 14:00 (180 mins)
      const current = new Date('2026-05-24T11:00:00');
      const result = getNextEvent(mockDays, current);
      expect(result).toEqual({ title: 'Lunch', minutes: 180 });
    });

    it('should find the next event tomorrow if today is done', () => {
      // Current time: 15:00 on May 24. Next event is Train at 09:00 tomorrow (18 hours = 1080 mins)
      const current = new Date('2026-05-24T15:00:00');
      const result = getNextEvent(mockDays, current);
      expect(result).toEqual({ title: 'Train', minutes: 1080 });
    });

    it('should return null if it is the last day and all events passed', () => {
      const current = new Date('2026-05-25T15:00:00');
      const result = getNextEvent(mockDays, current);
      expect(result).toBeNull();
    });
  });

});
