import express from 'express';
import cors from 'cors';
import webPush from 'web-push';
import fs from 'fs';
import path from 'path';

export const app = express();

app.use(cors({
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));

app.use(express.json());

export interface SubscriptionData {
  subscription: webPush.PushSubscription;
  settings: {
    notifyMinutesBefore: number;
    notifyUrgentMinutesBefore: number;
    disabledCategories?: string[];
    timezone?: string; // Persistent local timezone uploaded by the device
  };
  lastHeadsUpEvent?: string; // e.g. "Dinner-2024-05-15"
  lastUrgentEvent?: string;
  isDev?: boolean;
}

// Set up the subscriptions file path (can be overridden for testing)
let subscriptionsFile = path.join(__dirname, '..', 'subscriptions.json');

export const setSubscriptionsFile = (filePath: string) => {
  subscriptionsFile = filePath;
};

// Helper to load subscriptions from our local JSON file
const loadSubscriptions = (): SubscriptionData[] => {
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
const saveSubscriptions = (subs: SubscriptionData[]) => {
  fs.writeFileSync(subscriptionsFile, JSON.stringify(subs, null, 2), 'utf8');
};

// Endpoint to receive new Push Subscriptions from the PWA
app.post('/subscribe', (req, res) => {
  const { subscription, settings } = req.body;
  
  if (!subscription || !subscription.endpoint) {
    console.error('Received invalid subscription payload:', req.body);
    return res.status(400).json({ error: 'Invalid subscription object: missing endpoint' });
  }

  const subscriptions = loadSubscriptions();
  
  // Find index to update or add
  const index = subscriptions.findIndex(s => s.subscription && s.subscription.endpoint === subscription.endpoint);
  
  const newData: SubscriptionData = {
    subscription,
    settings: settings || { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1, disabledCategories: [] },
    isDev: req.body.isDev === true
  };

  if (index !== -1) {
    subscriptions[index] = newData;
    console.log('Updated existing subscription settings.');
  } else {
    subscriptions.push(newData);
    console.log('New subscription added. Total:', subscriptions.length);
  }
  
  saveSubscriptions(subscriptions);
  res.status(201).json({ success: true });
});

// Endpoint to remove an existing Push Subscription when a user opts out
app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  
  if (!endpoint) {
    return res.status(400).json({ error: 'Invalid endpoint' });
  }

  const subscriptions = loadSubscriptions();
  const index = subscriptions.findIndex(s => s.subscription && s.subscription.endpoint === endpoint);
  
  if (index !== -1) {
    subscriptions.splice(index, 1);
    saveSubscriptions(subscriptions);
    console.log('Subscription removed. Total:', subscriptions.length);
  }
  
  res.status(200).json({ success: true });
});

// A simple test endpoint to manually trigger a push to all subscribers
app.post('/test-broadcast', async (req, res) => {
  try {
    const { type = 'info', body = 'This is a test web push notification from the local Express server!', title = 'Test Broadcast' } = req.body || {};
    
    const payload = JSON.stringify({
      title,
      body,
      type
    });

    const subscriptions = loadSubscriptions();
    const targets = subscriptions.filter(s => s.isDev === true);
    
    if (targets.length === 0) {
      return res.status(400).json({ message: 'No developer subscriptions found' });
    }

    const results = await Promise.allSettled(
      targets.map(sub => webPush.sendNotification(sub.subscription, payload))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`Broadcast complete. Sent ${successful}/${targets.length}`);
    
    res.status(200).json({ 
      message: 'Broadcast complete', 
      sent: successful, 
      total: targets.length 
    });
  } catch (error) {
    console.error('Test broadcast failed:', error);
    res.status(500).json({ error: 'Internal server error during broadcast' });
  }
});
