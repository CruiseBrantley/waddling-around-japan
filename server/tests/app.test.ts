/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import { app, setSubscriptionsFile, setAdvisorCacheFile } from '../src/app';
import fs from 'fs';
import path from 'path';

// Mock web-push to avoid sending real pushes during testing
jest.mock('web-push', () => ({
  sendNotification: jest.fn().mockResolvedValue({})
}));

// Mock sheets to prevent network hits during poll testing
jest.mock('../src/sheets', () => ({
  fetchItinerary: jest.fn().mockResolvedValue({ days: [] })
}));

describe('Express Server API Tests', () => {
  const TEST_SUBS_FILE = path.join(__dirname, 'test-subs.json');
  const TEST_ADVISOR_FILE = path.join(__dirname, 'test-advisor.json');

  beforeAll(() => {
    // Direct the app to use a test subscriptions file and advisor cache file
    setSubscriptionsFile(TEST_SUBS_FILE);
    setAdvisorCacheFile(TEST_ADVISOR_FILE);
  });

  beforeEach(() => {
    // Clear out the test files before each test
    if (fs.existsSync(TEST_SUBS_FILE)) {
      fs.unlinkSync(TEST_SUBS_FILE);
    }
    if (fs.existsSync(TEST_ADVISOR_FILE)) {
      fs.unlinkSync(TEST_ADVISOR_FILE);
    }
  });

  afterAll(() => {
    // Clean up
    if (fs.existsSync(TEST_SUBS_FILE)) {
      fs.unlinkSync(TEST_SUBS_FILE);
    }
    if (fs.existsSync(TEST_ADVISOR_FILE)) {
      fs.unlinkSync(TEST_ADVISOR_FILE);
    }
  });

  it('should reject invalid subscriptions on /subscribe', async () => {
    const response = await request(app)
      .post('/subscribe')
      .send({ invalidData: true });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid subscription object: missing endpoint' });
  });

  it('should accept valid subscriptions on /subscribe and save to file', async () => {
    const mockSubscription = { endpoint: 'https://example.com/push/123', keys: { auth: 'a', p256dh: 'b' } };
    const payload = { 
      subscription: mockSubscription, 
      settings: { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1 },
      isDev: false
    };

    const response = await request(app)
      .post('/subscribe')
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true });

    // Verify it was written to the file
    expect(fs.existsSync(TEST_SUBS_FILE)).toBe(true);
    const data = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(data.length).toBe(1);
    expect(data[0].subscription.endpoint).toBe(mockSubscription.endpoint);
  });

  it('should not add duplicate subscriptions on /subscribe', async () => {
    const mockSubscription = { endpoint: 'https://example.com/push/123' };
    const payload = { subscription: mockSubscription };

    // Subscribe once
    await request(app).post('/subscribe').send(payload);
    
    // Subscribe again with exact same endpoint
    const response2 = await request(app)
      .post('/subscribe')
      .send(payload);

    expect(response2.status).toBe(201);

    // Verify file only contains 1
    const data = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(data.length).toBe(1);
  });

  it('should fail /test-broadcast if no developer subscriptions found', async () => {
    const response = await request(app).post('/test-broadcast');
    
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('No developer subscriptions found');
  });

  it('should succeed /test-broadcast if developer subscriptions exist', async () => {
    // Subscribe as dev
    await request(app)
      .post('/subscribe')
      .send({ 
        subscription: { endpoint: 'https://example.com/push/dev' },
        isDev: true
      });

    const response = await request(app).post('/test-broadcast');
    
    expect(response.status).toBe(200);
    expect(response.body.sent).toBe(1);
    expect(response.body.total).toBe(1);
  });

  it('should trigger manual polling on /poll and accept mockTime', async () => {
    const response = await request(app)
      .post('/poll')
      .send({ mockTime: '2026-05-24T12:00:00Z' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.mockTimeUsed).toBe('2026-05-24T12:00:00.000Z');
  });

  it('should reject invalid mockTime format on /poll', async () => {
    const response = await request(app)
      .post('/poll')
      .send({ mockTime: 'not-a-date' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid mockTime format');
  });

  it('should reset duplication logs for developers when debugOffset is updated on /subscribe', async () => {
    const mockSubscription = { endpoint: 'https://example.com/push/dev-reset-test' };
    
    // First subscribe with no offset, but with recorded event keys
    await request(app)
      .post('/subscribe')
      .send({ 
        subscription: mockSubscription, 
        settings: { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1, debugOffset: 1000 },
        isDev: true
      });

    // Manually inject some mock event keys to simulate an already-triggered notification
    const dataBefore = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    dataBefore[0].lastHeadsUpEvent = 'Breakfast-10:00';
    dataBefore[0].lastUrgentEvent = 'Breakfast-10:00';
    fs.writeFileSync(TEST_SUBS_FILE, JSON.stringify(dataBefore, null, 2), 'utf8');

    // Subscribe again with the SAME debug offset -> should preserve logs
    await request(app)
      .post('/subscribe')
      .send({ 
        subscription: mockSubscription, 
        settings: { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1, debugOffset: 1000 },
        isDev: true
      });
    
    const dataPreserved = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(dataPreserved[0].lastHeadsUpEvent).toBe('Breakfast-10:00');
    expect(dataPreserved[0].lastUrgentEvent).toBe('Breakfast-10:00');

    // Subscribe again with a DIFFERENT debug offset -> should reset logs
    await request(app)
      .post('/subscribe')
      .send({ 
        subscription: mockSubscription, 
        settings: { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1, debugOffset: 2000 },
        isDev: true
      });

    const dataReset = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(dataReset[0].lastHeadsUpEvent).toBeUndefined();
    expect(dataReset[0].lastUrgentEvent).toBeUndefined();
  });

  it('should automatically reset dev duplication logs on manual mock-time /poll', async () => {
    // 1. Subscribe as a developer and manually record some event keys
    await request(app)
      .post('/subscribe')
      .send({ 
        subscription: { endpoint: 'https://example.com/push/dev-poll-reset' },
        settings: { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1 },
        isDev: true
      });

    const dataBefore = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    dataBefore[0].lastHeadsUpEvent = 'Breakfast-10:00';
    dataBefore[0].lastUrgentEvent = 'Breakfast-10:00';
    fs.writeFileSync(TEST_SUBS_FILE, JSON.stringify(dataBefore, null, 2), 'utf8');

    // 2. Call /poll with a mockTime
    await request(app)
      .post('/poll')
      .send({ mockTime: '2026-05-24T12:00:00Z' });

    // 3. Verify they were reset
    const dataAfter = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(dataAfter[0].lastHeadsUpEvent).toBeUndefined();
    expect(dataAfter[0].lastUrgentEvent).toBeUndefined();
  });

  describe('AI Travel Advisor Cache & Generation Endpoints', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('GET /advisor should return the entire cache if date or region is missing', async () => {
      const response = await request(app).get('/advisor');
      expect(response.status).toBe(200);
      expect(response.body.cache).toBeDefined();
    });

    it('POST /advisor should store and allow GET to retrieve cached advisor notes inside the bulk cache', async () => {
      // 1. Store
      const postRes = await request(app)
        .post('/advisor')
        .send({
          date: '2026-05-24',
          region: 'Kyoto',
          content: 'Kyoto is expected to be cloudy. Wear light shoes.'
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.success).toBe(true);

      // 2. Retrieve via bulk cache GET /advisor
      const getRes = await request(app).get('/advisor');
      expect(getRes.status).toBe(200);
      expect(getRes.body.cache['2026-05-24_kyoto']).toBeDefined();
      expect(getRes.body.cache['2026-05-24_kyoto'].content).toBe('Kyoto is expected to be cloudy. Wear light shoes.');
    });

    it('POST /advisor/generate should return cached value if already cached', async () => {
      // Pre-cache
      const postRes = await request(app)
        .post('/advisor')
        .send({
          date: '2026-05-24',
          region: 'Tokyo',
          content: 'Already in cache!'
        });
      expect(postRes.status).toBe(201);

      // Call generate
      const response = await request(app)
        .post('/advisor/generate')
        .send({
          date: '2026-05-24',
          region: 'Tokyo',
          weather: { currentTemp: 70, tempMax: 80, tempMin: 60, condition: 'Sunny', precipProb: 0, humidity: 50, windSpeed: 10 },
          activities: []
        });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('Already in cache!');
      expect(response.body.source).toBe('cache');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('POST /advisor/generate should generate using local Gemma if Gemma is online', async () => {
      // Mock successful Gemma fetch response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: 'Gemma generated content: Tokyo is sunny and beautiful.'
          }
        })
      } as any);

      const response = await request(app)
        .post('/advisor/generate')
        .send({
          date: '2026-05-24',
          region: 'Tokyo',
          weather: { currentTemp: 70, tempMax: 80, tempMin: 60, condition: 'Sunny', precipProb: 0, humidity: 50, windSpeed: 10 },
          activities: []
        });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('Gemma generated content: Tokyo is sunny and beautiful.');
      expect(response.body.source).toBe('gemma');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      
      // Verify first fetch call was made to local Gemma endpoint
      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe('http://192.168.50.182:11434/api/chat');
    });

    it('POST /advisor/generate should generate using fallback Gemma (Mac Mini) if primary Gemma is down but fallback is online', async () => {
      // 1. Mock primary Gemma/Ollama endpoint failing
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));

      // 2. Mock successful fallback Gemma fetch response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: 'Gemma fallback generated content: Kyoto is cool and serene.'
          }
        })
      } as any);

      const response = await request(app)
        .post('/advisor/generate')
        .send({
          date: '2026-05-24',
          region: 'Kyoto',
          weather: { currentTemp: 65, tempMax: 75, tempMin: 55, condition: 'Clear', precipProb: 0, humidity: 40, windSpeed: 5 },
          activities: [],
          ollamaFallbackModel: 'gemma4:e4b',
          ollamaFallbackUrl: 'http://192.168.50.135:11434/api/chat'
        });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('Gemma fallback generated content: Kyoto is cool and serene.');
      expect(response.body.source).toBe('gemma-fallback');
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Verify the first call was to the primary Ollama url
      const firstCallUrl = fetchSpy.mock.calls[0][0];
      expect(firstCallUrl).toBe('http://192.168.50.182:11434/api/chat');

      // Verify the second call was to the fallback Ollama url
      const secondCallUrl = fetchSpy.mock.calls[1][0];
      expect(secondCallUrl).toBe('http://192.168.50.135:11434/api/chat');
    });

    it('POST /advisor/generate should fall back to Gemini API if local Gemma is down', async () => {
      // 1. Mock both Gemma/Ollama endpoints failing (rejection or non-ok status)
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));

      // 2. Mock Gemini API succeeding
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Gemini fallback content: Enjoy Tokyo under the blue sky.'
                  }
                ]
              }
            }
          ]
        })
      } as any);

      const response = await request(app)
        .post('/advisor/generate')
        .send({
          date: '2026-05-24',
          region: 'TokyoFallback',
          weather: { currentTemp: 70, tempMax: 80, tempMin: 60, condition: 'Sunny', precipProb: 0, humidity: 50, windSpeed: 10 },
          activities: [],
          geminiApiKey: 'mock-gemini-key',
          geminiModel: 'gemini-2.5-flash'
        });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('Gemini fallback content: Enjoy Tokyo under the blue sky.');
      expect(response.body.source).toBe('gemini');
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Verify the third call was to the Gemini API
      const thirdCallUrl = fetchSpy.mock.calls[2][0];
      expect(thirdCallUrl).toContain('generativelanguage.googleapis.com');
      expect(thirdCallUrl).toContain('mock-gemini-key');
    });
  });

  describe('CORS Configuration Tests', () => {
    it('should allow requests from allowed origins and return correct CORS headers', async () => {
      const response = await request(app)
        .get('/weather')
        .query({ region: 'Tokyo', date: '2026-05-24' })
        .set('Origin', 'http://localhost:5173');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should allow requests from localtunnel origins dynamically', async () => {
      const response = await request(app)
        .get('/weather')
        .query({ region: 'Tokyo', date: '2026-05-24' })
        .set('Origin', 'https://waddling-around-japan-pi.loca.lt');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://waddling-around-japan-pi.loca.lt');
    });

    it('should handle preflight OPTIONS requests for allowed origins', async () => {
      const response = await request(app)
        .options('/weather')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'content-type');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-methods']).toContain('GET');
    });

    it('should NOT return Access-Control-Allow-Origin header for disallowed origins and NOT throw 500 error', async () => {
      const response = await request(app)
        .get('/weather')
        .query({ region: 'Tokyo', date: '2026-05-24' })
        .set('Origin', 'https://evil-untrusted-domain.com');

      // The server should not throw a 500. It should still execute the request or reject it gracefully.
      // With cors middleware, if callback(null, false) is called, it completes the request without the CORS header.
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should NOT return Access-Control-Allow-Origin header for preflight OPTIONS requests of disallowed origins', async () => {
      const response = await request(app)
        .options('/weather')
        .set('Origin', 'https://evil-untrusted-domain.com')
        .set('Access-Control-Request-Method', 'GET');

      // For rejected preflights, CORS middleware usually responds with 204/200 but omits the Access-Control-Allow-Origin header
      expect([200, 204]).toContain(response.status);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

