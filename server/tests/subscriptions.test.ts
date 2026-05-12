import request from 'supertest';
import { app, setSubscriptionsFile } from '../src/app';
import fs from 'fs';
import path from 'path';

const testFile = path.join(__dirname, 'test-subscriptions.json');

beforeAll(() => {
  // Point the backend to a temporary JSON file so we don't clobber live data during testing
  setSubscriptionsFile(testFile);
});

afterAll(() => {
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }
});

beforeEach(() => {
  // Start with a clean slate for each test
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }
});

describe('Push Subscription API', () => {
  const dummySub = {
    subscription: {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz-dummy-token',
      keys: { p256dh: 'test-p256dh', auth: 'test-auth' }
    },
    settings: {
      notifyMinutesBefore: 15,
      notifyUrgentMinutesBefore: 2,
      disabledCategories: []
    },
    isDev: true
  };

  it('should add a new subscription to the registry when POST /subscribe is called', async () => {
    const res = await request(app)
      .post('/subscribe')
      .send(dummySub);
    
    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toEqual(true);
    
    const fileData = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(fileData).toHaveLength(1);
    expect(fileData[0].subscription.endpoint).toEqual(dummySub.subscription.endpoint);
    expect(fileData[0].settings.notifyMinutesBefore).toEqual(15);
  });

  it('should remove an existing subscription from the registry when POST /unsubscribe is called', async () => {
    // 1. Add it first
    await request(app).post('/subscribe').send(dummySub);
    let fileData = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(fileData).toHaveLength(1);

    // 2. Unsubscribe using the matching endpoint URL
    const res = await request(app)
      .post('/unsubscribe')
      .send({ endpoint: dummySub.subscription.endpoint });
    
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toEqual(true);

    // 3. Verify it was physically deleted from the persistent JSON file
    fileData = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(fileData).toHaveLength(0);
  });

  it('should not crash or fail when trying to unsubscribe an unknown endpoint', async () => {
    const res = await request(app)
      .post('/unsubscribe')
      .send({ endpoint: 'https://fake-endpoint.com/does-not-exist' });
    
    // It should gracefully succeed (idempotent delete)
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toEqual(true);
  });
});
