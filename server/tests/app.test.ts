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
});
