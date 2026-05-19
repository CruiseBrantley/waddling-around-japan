import request from 'supertest';
import { app, setSubscriptionsFile } from '../src/app';
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

  beforeAll(() => {
    // Direct the app to use a test subscriptions file
    setSubscriptionsFile(TEST_SUBS_FILE);
  });

  beforeEach(() => {
    // Clear out the test subscriptions file before each test
    if (fs.existsSync(TEST_SUBS_FILE)) {
      fs.unlinkSync(TEST_SUBS_FILE);
    }
  });

  afterAll(() => {
    // Clean up
    if (fs.existsSync(TEST_SUBS_FILE)) {
      fs.unlinkSync(TEST_SUBS_FILE);
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
});
