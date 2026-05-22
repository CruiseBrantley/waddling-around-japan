/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
import express from 'express';
import cors from 'cors';
import webPush from 'web-push';
import fs from 'fs';
import path from 'path';
import { pollAndNotify } from './poller';
import { asyncGetWeatherData, getWeatherData } from './weather';
import { generateAdvisory, setAdvisorCacheFile, loadAdvisorCache, saveAdvisorCache } from './generator';

export const app = express();

// Allowed origins: Firebase Hosting, ngrok tunnels, localtunnel, and localhost for dev
const ALLOWED_ORIGINS = [
  'https://waddling-around-japan.web.app',
  'https://waddling-around-japan.firebaseapp.com',
  'https://waddling-around-japan.github.io',
  'https://sirian.ddns.net',
  'https://waddling-around-japan-pi.loca.lt',
  'https://waddling-cruise-pi.loca.lt',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

// CORS helper: validate origin against allowed list or localhost/ip patterns
function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Allow requests without origin (curl, postman, etc.)
  
  // Always allow localhost/127.0.0.1 for local development
  if (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.startsWith('http://[::1]:')
  ) {
    return true;
  }
  
  // Allow any explicit allowed origin from our list
  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }
  
  // Allow any ngrok/Cloudflare tunnel/loca.lt origin (common dev pattern)
  if (origin.includes('.ngrok') || origin.includes('.loca.lt') || origin.includes('.trycloudflare.com')) {
    return true;
  }
  
  // Allow any local IP (192.168.x.x, 10.x.x.x, 172.x.x.x)
  const url = new URL(origin);
  const hostname = url.hostname;
  if (
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.')
  ) {
    return true;
  }
  
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning',
    'Bypass-Tunnel-Reminder',
    'Cache-Control',
    'Pragma',
  ],
  exposedHeaders: [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning',
    'Bypass-Tunnel-Reminder',
    'X-Request-Id',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  credentials: true,
  maxAge: 600, // Cache preflight results for 10 minutes
  optionsSuccessStatus: 204,
}));

// Respond to all OPTIONS preflight requests explicitly via global cors middleware


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

// Endpoint to fetch the full cached AI Travel Advisor cache packaged with weather.
// No query params = bulk load. Per-day parameterised fetching has been removed;
// clients must use the bulk endpoint on startup instead.
app.get('/advisor', async (req, res): Promise<any> => {
  const { currentTime } = req.query;
  const cache = loadAdvisorCache();

  console.log('Server: Serving full advisor cache packaged with weather');
  const systemTime = currentTime ? new Date(currentTime as string) : new Date();
  const packagedCache: Record<string, { content: string; weather: any }> = {};

  // Load regions cache dynamically to map full-day keys to their active regions
  const regionsCachePath = path.join(__dirname, '..', 'regions_cache.json');
  let regionsCache: Record<string, string[]> = {};
  if (fs.existsSync(regionsCachePath)) {
    try {
      regionsCache = JSON.parse(fs.readFileSync(regionsCachePath, 'utf8'));
    } catch (e) {
      console.error('Server: Failed to parse regions_cache.json', e);
    }
  }

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
      // Full day advisor key (no region suffix)
      packagedCache[key] = {
        content: cache[key],
        weather: null
      };

      // Generate and inject synthetic region-suffixed keys with live weather
      const dateStr = key;
      const regionsForDay = regionsCache[dateStr] || [];
      for (const reg of regionsForDay) {
        const legacyKey = `${dateStr}_${reg.toLowerCase()}`;
        if (!packagedCache[legacyKey]) {
          try {
            const weather = await asyncGetWeatherData(reg, dateStr, systemTime);
            packagedCache[legacyKey] = {
              content: cache[key],
              weather
            };
          } catch (err) {
            const fallbackWeather = getWeatherData(reg, dateStr, systemTime);
            packagedCache[legacyKey] = {
              content: cache[key],
              weather: fallbackWeather
            };
          }
        }
      }
    }
  }

  return res.status(200).json({ cache: packagedCache });
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

// Endpoint to force regenerate all LLM advisor notes and refresh weather data
// Clears all caches, then triggers a full pre-cache scan which will re-fetch everything
app.post('/regenerate', async (req, res): Promise<any> => {
  try {
    console.log('Server: Regenerate endpoint called. Clearing all caches...');
    
    // Clear advisor cache
    const advisorCachePath = path.join(__dirname, '..', 'advisor_cache.json');
    if (fs.existsSync(advisorCachePath)) {
      fs.writeFileSync(advisorCachePath, JSON.stringify({}), 'utf8');
      console.log('Server: Cleared advisor cache');
    }
    
    // Clear regions cache
    const regionsCachePath = path.join(__dirname, '..', 'regions_cache.json');
    if (fs.existsSync(regionsCachePath)) {
      fs.writeFileSync(regionsCachePath, JSON.stringify({}), 'utf8');
      console.log('Server: Cleared regions cache');
    }
    
    // Clear geocoding cache
    const geoCachePath = path.join(__dirname, '..', 'geocoding_cache.json');
    if (fs.existsSync(geoCachePath)) {
      fs.writeFileSync(geoCachePath, JSON.stringify({}), 'utf8');
      console.log('Server: Cleared geocoding cache');
    }
    
    // Clear weather cache
    const weatherCachePath = path.join(__dirname, '..', 'weather_cache.json');
    if (fs.existsSync(weatherCachePath)) {
      fs.writeFileSync(weatherCachePath, JSON.stringify({}), 'utf8');
      console.log('Server: Cleared weather cache');
    }
    
    // Trigger fresh pre-cache scan (region extraction + weather + advisor generation)
    const { generateMissingAdvisories } = require('./poller');
    await generateMissingAdvisories();
    
    console.log('Server: Regeneration complete');
    return res.status(200).json({ 
      success: true, 
      message: 'All caches cleared and regeneration triggered' 
    });
  } catch (err: any) {
    console.error('Server: Regeneration failed:', err);
    return res.status(500).json({
      error: `Regeneration failed: ${err.message || err}`
    });
  }
});
