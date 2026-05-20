import { asyncGetWeatherData, parseDateStrToYYYYMMDD } from '../src/weather';
import fs from 'fs';

describe('Server Weather Service Tests', () => {
  describe('parseDateStrToYYYYMMDD', () => {
    it('should parse standard YYYY-MM-DD ISO date strings correctly', () => {
      expect(parseDateStrToYYYYMMDD('2026-05-24T12:00:00Z')).toBe('2026-05-24');
      expect(parseDateStrToYYYYMMDD('2026-05-24')).toBe('2026-05-24');
    });

    it('should parse sheets formatted strings correctly', () => {
      expect(parseDateStrToYYYYMMDD('Sun, 5/24/26')).toBe('2026-05-24');
      expect(parseDateStrToYYYYMMDD('Mon, 12/05/26')).toBe('2026-12-05');
      expect(parseDateStrToYYYYMMDD('5/24/2026')).toBe('2026-05-24');
    });

    it('should return null for invalid date strings', () => {
      expect(parseDateStrToYYYYMMDD('invalid-date')).toBeNull();
      expect(parseDateStrToYYYYMMDD('')).toBeNull();
    });
  });

  describe('asyncGetWeatherData Host-Timezone Agnosticism', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalFetch = global.fetch;
    let mockFetch: jest.Mock;

    beforeAll(() => {
      // Force actual execution logic of asyncGetWeatherData by simulating production environment
      process.env.NODE_ENV = 'production';
    });

    afterAll(() => {
      process.env.NODE_ENV = originalEnv;
    });

    beforeEach(() => {
      mockFetch = jest.fn();
      global.fetch = mockFetch;

      // Spy on fs.existsSync to simulate clean weather cache
      jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('weather_cache.json')) {
          return false;
        }
        return true;
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
      jest.restoreAllMocks();
    });

    const mockOpenMeteoResponse = {
      daily: {
        time: ['2026-05-24'],
        temperature_2m_max: [78],
        temperature_2m_min: [60],
        weather_code: [0]
      },
      hourly: {
        time: Array.from({ length: 24 }, (_, h) => `2026-05-24T${String(h).padStart(2, '0')}:00`),
        temperature_2m: [
          60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
          72, 73, 74, 75, 76, 77, 78, 77, 76, 75, 74, 73
        ],
        relative_humidity_2m: Array(24).fill(50),
        precipitation_probability: Array(24).fill(0),
        weather_code: Array(24).fill(0),
        wind_speed_10m: Array(24).fill(5)
      }
    };

    it('should correctly extract currentTemp corresponding to Japan local hour, regardless of server host timezone', async () => {
      // 1. Mock fetch response for Open-Meteo forecast API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOpenMeteoResponse
      });

      // 2. We mock system time as 2026-05-24T06:00:00.000Z.
      // 06:00:00 UTC corresponds to exactly 15:00:00 (3:00 PM) in Tokyo (UTC+9).
      const systemTimeInUTC = new Date('2026-05-24T06:00:00.000Z');

      // 3. Query weather data for Tokyo. 
      // Regardless of what timezone the test runner or host OS resides in, 
      // the system time 06:00Z should resolve to 3 PM local time in Tokyo.
      const weather = await asyncGetWeatherData('Tokyo', '2026-05-24', systemTimeInUTC);

      // 4. Assert correctness
      expect(weather.region).toBe('Tokyo');
      expect(weather.tempMax).toBe(78);
      expect(weather.tempMin).toBe(60);
      
      // Tokyo hour is 15:00, which has index 15. The temperature in mock response at index 15 is 75°F.
      // If host timezone leaked, it would pick different hours (e.g. UTC hour 6 -> 66°F, or US central hour 1 -> 61°F).
      expect(weather.currentTemp).toBe(75);
      
      // Verify hourly array elements
      expect(weather.hourly).toHaveLength(24);
      expect(weather.hourly[15].temp).toBe(75);
    });
  });
});
