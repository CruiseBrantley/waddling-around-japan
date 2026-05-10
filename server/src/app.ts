import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import webPush from 'web-push';
import fs from 'fs';
import path from 'path';

export const app = express();
app.use(cors());
app.use(bodyParser.json());

// Set up the subscriptions file path (can be overridden for testing)
let subscriptionsFile = path.join(__dirname, '..', 'subscriptions.json');

export const setSubscriptionsFile = (filePath: string) => {
  subscriptionsFile = filePath;
};

// Helper to load subscriptions from our local JSON file
const loadSubscriptions = (): webPush.PushSubscription[] => {
  if (fs.existsSync(subscriptionsFile)) {
    const data = fs.readFileSync(subscriptionsFile, 'utf8');
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Error parsing subscriptions file', e);
      return [];
    }
  }
  return [];
};

// Helper to save subscriptions to our local JSON file
const saveSubscriptions = (subs: webPush.PushSubscription[]) => {
  fs.writeFileSync(subscriptionsFile, JSON.stringify(subs, null, 2), 'utf8');
};

// Endpoint to receive new Push Subscriptions from the PWA
app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  const subscriptions = loadSubscriptions();
  
  // Prevent duplicate subscriptions (based on endpoint)
  const exists = subscriptions.find(sub => sub.endpoint === subscription.endpoint);
  if (!exists) {
    subscriptions.push(subscription);
    saveSubscriptions(subscriptions);
    console.log('New subscription added. Total:', subscriptions.length);
  }

  res.status(201).json({ success: true });
});

// A simple test endpoint to manually trigger a push to all subscribers
app.post('/test-broadcast', async (req, res) => {
  const payload = JSON.stringify({
    title: 'Test Broadcast',
    body: 'This is a test web push notification from the local Express server!',
    type: 'info'
  });

  const subscriptions = loadSubscriptions();
  if (subscriptions.length === 0) {
    return res.status(400).json({ message: 'No subscriptions found' });
  }

  const results = await Promise.allSettled(
    subscriptions.map(sub => webPush.sendNotification(sub, payload))
  );

  const successful = results.filter(r => r.status === 'fulfilled').length;
  console.log(`Broadcast complete. Sent ${successful}/${subscriptions.length}`);
  
  res.status(200).json({ 
    message: 'Broadcast complete', 
    sent: successful, 
    total: subscriptions.length 
  });
});
