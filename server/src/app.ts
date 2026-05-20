import express from 'express';
import cors from 'cors';
import webPush from 'web-push';
import fs from 'fs';
import path from 'path';
import { pollAndNotify } from './poller';
import { asyncGetWeatherData, getWeatherData, parseDateStrToYYYYMMDD } from './weather';
import { fetchItinerary } from './sheets';
import { generateAdvisory, setAdvisorCacheFile, loadAdvisorCache, saveAdvisorCache, extractRegionsForDay } from './generator';

export const app = express();

app.use(cors({
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

export interface SubscriptionData {
  subscription: webPush.PushSubscription;
  settings: {
    notifyMinutesBefore: number;
    notifyUrgentMinutesBefore: number;
    disabledCategories?: string[];
    timezone?: string; // Persistent local timezone uploaded by the device
    debugOffset?: number | null; // Milliseconds offset from real system time for mocking
  };
  lastHeadsUpEvent?: string; // e.g. "Dinner-2024-05-15"
  lastUrgentEvent?: string;
  isDev?: boolean;
  isDead?: boolean;
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

export { setAdvisorCacheFile };

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
  const existing = index !== -1 ? subscriptions[index] : null;
  
  const newData: SubscriptionData = {
    subscription,
    settings: settings || { notifyMinutesBefore: 10, notifyUrgentMinutesBefore: 1, disabledCategories: [] },
    isDev: req.body.isDev === true,
    lastHeadsUpEvent: existing?.lastHeadsUpEvent,
    lastUrgentEvent: existing?.lastUrgentEvent
  };

  // If this is a developer subscription, reset their duplication logs if the debug offset has changed,
  // which indicates they shifted or rewound the mock time for notification testing.
  if (newData.isDev && existing) {
    const oldOffset = existing.settings?.debugOffset;
    const newOffset = newData.settings?.debugOffset;
    if (oldOffset !== newOffset) {
      console.log(`Resetting dev notification duplication logs for ${subscription.endpoint} because debug time offset changed from ${oldOffset} to ${newOffset}.`);
      newData.lastHeadsUpEvent = undefined;
      newData.lastUrgentEvent = undefined;
    }
  }

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

// Endpoint to trigger a manual polling cycle (optionally with a mock time payload)
app.post('/poll', async (req, res) => {
  try {
    const { mockTime } = req.body || {};
    let parsedMockTime: Date | undefined;

    if (mockTime) {
      parsedMockTime = new Date(mockTime);
      if (isNaN(parsedMockTime.getTime())) {
        return res.status(400).json({ error: 'Invalid mockTime format. Must be a valid ISO 8601 absolute date string.' });
      }

      // Automatically reset duplication logs for all developer subscriptions during manual mock time polls
      // to make rewinding and retesting notifications completely seamless!
      const subscriptions = loadSubscriptions();
      let updated = false;
      for (const sub of subscriptions) {
        if (sub.isDev) {
          sub.lastHeadsUpEvent = undefined;
          sub.lastUrgentEvent = undefined;
          updated = true;
        }
      }
      if (updated) {
        saveSubscriptions(subscriptions);
        console.log('Reset dev notification duplication logs for manual mock time poll.');
      }
    }

    console.log(`Triggering manual polling cycle. MockTime = ${parsedMockTime ? parsedMockTime.toISOString() : 'system time'}`);
    await pollAndNotify(parsedMockTime);

    res.status(200).json({
      success: true,
      message: 'Polling run triggered successfully.',
      mockTimeUsed: parsedMockTime ? parsedMockTime.toISOString() : 'system time'
    });
  } catch (error) {
    console.error('Triggered polling failed:', error);
    res.status(500).json({ error: 'Internal server error during polling run.' });
  }
});

// Endpoint to fetch live weather data with offline fallbacks
app.get('/weather', async (req, res): Promise<any> => {
  const { region, date, currentTime } = req.query;
  
  if (!region || !date) {
    return res.status(400).json({ error: 'Missing required parameters: region, date' });
  }

  const systemTime = currentTime ? new Date(currentTime as string) : new Date();
  
  try {
    const weather = await asyncGetWeatherData(region as string, date as string, systemTime);
    return res.status(200).json(weather);
  } catch (error: any) {
    console.error(`Server: Failed to fetch async weather. Falling back. Error: ${error.message || error}`);
    // Safe synchronous fallback to guarantee success
    const fallback = getWeatherData(region as string, date as string, systemTime);
    return res.status(200).json(fallback);
  }
});

app.post('/regions', async (req, res): Promise<any> => {
  const { date, activities } = req.body;
  if (!date || !activities || !Array.isArray(activities)) {
    return res.status(400).json({ error: 'Missing required parameters: date, activities' });
  }

  try {
    const { extractRegionsForDay } = require('./generator');
    const regions = await extractRegionsForDay(date, activities);
    return res.status(200).json({ regions });
  } catch (error) {
    console.error('Failed to extract regions:', error);
    return res.status(500).json({ error: 'Internal server error', regions: ["Tokyo"] });
  }
});

app.get('/regions/bulk', async (req, res): Promise<any> => {
  try {
    const { fetchItinerary } = require('./sheets');
    const { extractBulkRegions } = require('./generator');
    
    // Server fetches the same Google Sheet data directly!
    const itinerary = await fetchItinerary();
    const days = itinerary.days;
    
    // Process all days in a single LLM prompt
    const regionsMap = await extractBulkRegions(days);
    
    return res.status(200).json({ regionsMap });
  } catch (error) {
    console.error('Failed to bulk extract regions:', error);
    return res.status(500).json({ error: 'Internal server error', regionsMap: {} });
  }
});

// Endpoint to fetch cached AI Travel Advisor notes (packaged with weather)
app.get('/advisor', async (req, res): Promise<any> => {
  const { date, region, currentTime } = req.query;
  const cache = loadAdvisorCache();

  if (!date) {
    console.log('Server: Serving full advisor cache packaged with weather');
    const systemTime = currentTime ? new Date(currentTime as string) : new Date();
    const packagedCache: Record<string, { content: string; weather: any }> = {};

    for (const key of Object.keys(cache)) {
      const lastUnderscore = key.lastIndexOf('_');
      if (lastUnderscore !== -1) {
        const dateStr = key.substring(0, lastUnderscore);
        const regionStr = key.substring(lastUnderscore + 1);
        try {
          const weather = await asyncGetWeatherData(regionStr, dateStr, systemTime);
          packagedCache[key] = {
            content: cache[key],
            weather
          };
        } catch (err) {
          const simulatedWeather = getWeatherData(regionStr, dateStr, systemTime);
          packagedCache[key] = {
            content: cache[key],
            weather: simulatedWeather
          };
        }
      } else {
        // Full day advisor key
        packagedCache[key] = {
          content: cache[key],
          weather: null
        };
      }
    }

    return res.status(200).json({ cache: packagedCache });
  }

  const systemTime = currentTime ? new Date(currentTime as string) : new Date();
  const cacheKey = date as string;
  const legacyCacheKey = region ? `${date}_${(region as string).toLowerCase()}` : null;

  try {
    // 1. Determine regions for this day
    let regions: string[] = [];
    if (region) {
      regions = [region as string];
    } else {
      try {
        const itinerary = await fetchItinerary();
        const targetDateStr = date as string;
        const targetYYYYMMDD = parseDateStrToYYYYMMDD(targetDateStr);
        const dayData = itinerary.days.find((d: any) => 
          d.date === targetDateStr || 
          (parseDateStrToYYYYMMDD(d.date) === targetYYYYMMDD)
        );
        if (dayData) {
          regions = await extractRegionsForDay(dayData.date, dayData.activities);
        }
      } catch (itineraryErr) {
        console.warn('Server: Failed to fetch itinerary to resolve regions:', itineraryErr);
      }
    }
    if (regions.length === 0) {
      regions = ["Tokyo"];
    }

    // 2. Pull the weather for all regions
    const weatherList = [];
    for (const reg of regions) {
      try {
        const weatherObj = await asyncGetWeatherData(reg, date as string, systemTime);
        weatherList.push(weatherObj);
      } catch (err) {
        const simulatedWeather = getWeatherData(reg, date as string, systemTime);
        weatherList.push(simulatedWeather);
      }
    }

    // For backwards compatibility with single-region clients/tests, send single "weather" field
    const weather = weatherList[0];

    // 3. Check if we have the advisor note in cache
    const cachedContent = cache[cacheKey] || (legacyCacheKey ? cache[legacyCacheKey] : null);
    if (cachedContent) {
      console.log(`Server: Serving cached advisor for ${cacheKey}`);
      return res.status(200).json({ content: cachedContent, weather, weatherList, regions });
    }

    // Bypass dynamic generation in test mode when not cached
    if (process.env.NODE_ENV === 'test') {
      console.log(`Server: Test environment cache miss bypass for ${cacheKey}`);
      return res.status(404).json({ content: null, weather, weatherList, regions });
    }

    // 4. Cache miss: attempt dynamic on-the-fly generation
    console.log(`Server: Cache miss for advisor ${cacheKey}. Attempting dynamic generation...`);
    let activities: any[] = [];
    try {
      const itinerary = await fetchItinerary();
      const targetDateStr = date as string;
      const targetYYYYMMDD = parseDateStrToYYYYMMDD(targetDateStr);

      const dayData = itinerary.days.find((d: any) => 
        d.date === targetDateStr || 
        (parseDateStrToYYYYMMDD(d.date) === targetYYYYMMDD)
      );
      if (dayData) {
        activities = dayData.activities;
      }
    } catch (itineraryErr) {
      console.warn('Server: Failed to fetch itinerary for dynamic advisor generation, using empty activities list:', itineraryErr);
    }

    try {
      const result = await generateAdvisory(date as string, regions, weatherList, activities);
      return res.status(200).json({ content: result.content, weather, weatherList, regions });
    } catch (genErr: any) {
      console.error(`Server: Dynamic advisor generation failed: ${genErr.message || genErr}`);
      return res.status(200).json({ content: null, weather, weatherList, regions });
    }
  } catch (err: any) {
    console.error(`Server: Failed in /advisor endpoint. Error: ${err.message || err}`);
    // Safe fallback: return simulated weather and null content
    const fallbackReg = region as string || 'Tokyo';
    const fallbackWeather = getWeatherData(fallbackReg, date as string, systemTime);
    return res.status(200).json({ content: null, weather: fallbackWeather, weatherList: [fallbackWeather], regions: [fallbackReg] });
  }
});

// Endpoint to store cached AI Travel Advisor notes
app.post('/advisor', (req, res) => {
  const { date, region, content } = req.body;
  if (!date || !content) {
    return res.status(400).json({ error: 'Missing date or content' });
  }

  const cacheKey = `${date}`;
  const cache = loadAdvisorCache();

  cache[cacheKey] = content;
  if (region) {
    const legacyKey = `${date}_${region.toLowerCase()}`;
    cache[legacyKey] = content;
  }

  saveAdvisorCache(cache);

  console.log(`Server: Cached advisor for ${cacheKey}`);
  res.status(201).json({ success: true });
});

// Endpoint to generate daily AI Travel Advisor notes
app.post('/advisor/generate', async (req, res): Promise<any> => {
  const {
    date,
    region,
    regions,
    weather,
    weatherList,
    activities,
    geminiApiKey,
    geminiModel,
    ollamaModel,
    ollamaFallbackModel,
    ollamaFallbackUrl
  } = req.body;
  
  if (!date || !activities) {
    return res.status(400).json({ error: 'Missing required parameters: date or activities' });
  }

  const resolvedRegions = regions || (region ? [region] : ["Tokyo"]);
  const resolvedWeatherList = weatherList || (weather ? [weather] : []);

  try {
    const result = await generateAdvisory(date, resolvedRegions, resolvedWeatherList, activities, {
      geminiApiKey,
      geminiModel,
      ollamaModel,
      ollamaFallbackModel,
      ollamaFallbackUrl
    });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('API Advisor generation failed:', err);
    return res.status(500).json({
      error: `Failed to generate advisory note: ${err.message || err}`
    });
  }
});
