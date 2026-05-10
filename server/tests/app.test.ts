import request from 'supertest';
import { app, setSubscriptionsFile } from '../src/app';
import fs from 'fs';
import path from 'path';

// Mock web-push to avoid sending real pushes during testing
jest.mock('web-push', () => ({
  sendNotification: jest.fn().mockResolvedValue({})
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
    expect(response.body).toEqual({ error: 'Invalid subscription object' });
  });

  it('should accept valid subscriptions on /subscribe and save to file', async () => {
    const mockSubscription = { endpoint: 'https://example.com/push/123', keys: { auth: 'a', p256dh: 'b' } };

    const response = await request(app)
      .post('/subscribe')
      .send(mockSubscription);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true });

    // Verify it was written to the file
    expect(fs.existsSync(TEST_SUBS_FILE)).toBe(true);
    const data = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(data.length).toBe(1);
    expect(data[0].endpoint).toBe(mockSubscription.endpoint);
  });

  it('should not add duplicate subscriptions on /subscribe', async () => {
    const mockSubscription = { endpoint: 'https://example.com/push/123' };

    // Subscribe once
    await request(app).post('/subscribe').send(mockSubscription);
    
    // Subscribe again with exact same endpoint
    const response2 = await request(app)
      .post('/subscribe')
      .send(mockSubscription);

    expect(response2.status).toBe(201);

    // Verify file only contains 1
    const data = JSON.parse(fs.readFileSync(TEST_SUBS_FILE, 'utf8'));
    expect(data.length).toBe(1);
  });

  it('should fail /test-broadcast if no subscriptions exist', async () => {
    const response = await request(app).post('/test-broadcast');
    
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('No subscriptions found');
  });

  it('should succeed /test-broadcast if subscriptions exist', async () => {
    // Subscribe first
    await request(app)
      .post('/subscribe')
      .send({ endpoint: 'https://example.com/push/123' });

    const response = await request(app).post('/test-broadcast');
    
    expect(response.status).toBe(200);
    expect(response.body.sent).toBe(1);
    expect(response.body.total).toBe(1);
  });
});
