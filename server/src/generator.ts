/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty */
import fs from 'fs';
import path from 'path';

// Set up the advisor cache file path
let advisorCacheFile = path.join(__dirname, '..', 'advisor_cache.json');

const offlineOllamaServers = new Set<string>();

async function isOllamaOnline(url: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'test') {
    return true;
  }

  let baseUrl = url;
  try {
    const parsed = new URL(url);
    baseUrl = `${parsed.protocol}//${parsed.host}/`;
  } catch (e) {
    // Keep raw URL if parsing fails
  }

  if (offlineOllamaServers.has(baseUrl)) {
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(baseUrl, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      return true;
    }
  } catch (e: any) {
    clearTimeout(timeoutId);
  }

  console.warn(`Generator: Ollama server ${baseUrl} is OFFLINE. Caching state.`);
  offlineOllamaServers.add(baseUrl);
  
  // Clear from offline cache after 5 minutes
  setTimeout(() => {
    offlineOllamaServers.delete(baseUrl);
  }, 5 * 60 * 1000);

  return false;
}

// Helper to build prompt for AI travel advisor

export const setAdvisorCacheFile = (filePath: string) => {
  advisorCacheFile = filePath;
};

// Helper to load advisor cache from our local JSON file
export const loadAdvisorCache = (): Record<string, string> => {
  if (fs.existsSync(advisorCacheFile)) {
    const data = fs.readFileSync(advisorCacheFile, 'utf8');
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Error parsing advisor cache file', e);
      return {};
    }
  }
  return {};
};

// Helper to save advisor cache to our local JSON file
export const saveAdvisorCache = (cache: Record<string, string>) => {
  fs.writeFileSync(advisorCacheFile, JSON.stringify(cache, null, 2), 'utf8');
};

export function parseTimeToHour(timeStr: string): number | null {
  if (!timeStr) return null;
  const cleaned = timeStr.trim().toLowerCase();
  
  // Format check for HH:MM (possibly with AM/PM)
  const regex = /(\d+):(\d+)\s*(am|pm)?/;
  const match = cleaned.match(regex);
  if (match) {
    let hour = parseInt(match[1], 10);
    const isPm = match[3] === 'pm';
    const isAm = match[3] === 'am';
    
    if (isPm && hour < 12) {
      hour += 12;
    } else if (isAm && hour === 12) {
      hour = 0;
    }
    
    if (hour >= 0 && hour <= 23) {
      return hour;
    }
  }
  
  // Alternative match for just single numbers like "2 PM" or "14"
  const simpleRegex = /(\d+)\s*(am|pm)/;
  const simpleMatch = cleaned.match(simpleRegex);
  if (simpleMatch) {
    let hour = parseInt(simpleMatch[1], 10);
    const isPm = simpleMatch[2] === 'pm';
    if (isPm && hour < 12) {
      hour += 12;
    } else if (simpleMatch[2] === 'am' && hour === 12) {
      hour = 0;
    }
    if (hour >= 0 && hour <= 23) {
      return hour;
    }
  }
  
  return null;
}

const REGION_KEYWORD_MAP: Record<string, string[]> = {
  'chicago': ['ord', 'mdw', "o'hare", 'midway', 'chicago'],
  'bentonville': ['xna', 'bentonville'],
  'centerton': ['centerton'],
  'tokyo': ['hnd', 'nrt', 'haneda', 'narita', 'tokyo'],
  'osaka': ['kix', 'itm', 'kansai', 'itami', 'osaka'],
  'kyoto': ['kyoto'],
  'kobe': ['ukb', 'kobe'],
  'sapporo': ['cts', 'chitose', 'sapporo'],
  'hakodate': ['hkd', 'hakodate'],
  'fukuoka': ['fuk', 'fukuoka'],
  'nagoya': ['ngo', 'nagoya'],
  'hiroshima': ['hij', 'hiroshima']
};

const REGION_NAME_MAP: Record<string, string> = {
  'chicago': 'Chicago',
  'bentonville': 'Bentonville',
  'centerton': 'Centerton',
  'tokyo': 'Tokyo',
  'osaka': 'Osaka',
  'kyoto': 'Kyoto',
  'kobe': 'Kobe',
  'sapporo': 'Sapporo',
  'hakodate': 'Hakodate',
  'fukuoka': 'Fukuoka',
  'nagoya': 'Nagoya',
  'hiroshima': 'Hiroshima'
};

export function addImplicitRegions(regions: string[], activities: any[]): string[] {
  const updatedRegions = [...regions];
  if (!activities || activities.length === 0) return updatedRegions;

  for (const act of activities) {
    const title = (act.title || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    const location = (act.location || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    const notes = (act.notes || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    const resolvedName = (act.resolvedName || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    const resolvedAddress = (act.resolvedAddress || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');

    for (const [key, aliases] of Object.entries(REGION_KEYWORD_MAP)) {
      const regionName = REGION_NAME_MAP[key] || (key.charAt(0).toUpperCase() + key.slice(1));
      
      // If already in regions, no need to check
      if (updatedRegions.some(r => r.toLowerCase() === key)) {
        continue;
      }

      for (const alias of aliases) {
        let matched = false;
        if (alias.length <= 3) {
          const regex = new RegExp(`\\b${alias}\\b`, 'i');
          if (
            regex.test(title) ||
            regex.test(location) ||
            regex.test(notes) ||
            regex.test(resolvedName) ||
            regex.test(resolvedAddress)
          ) {
            matched = true;
          }
        } else {
          if (
            title.includes(alias) ||
            location.includes(alias) ||
            notes.includes(alias) ||
            resolvedName.includes(alias) ||
            resolvedAddress.includes(alias)
          ) {
            matched = true;
          }
        }

        if (matched) {
          updatedRegions.push(regionName);
          break; // Stop checking other aliases for this region key
        }
      }
    }
  }

  return updatedRegions;
}


 
export function findBestRegionForActivity(activity: any, regions: string[], previousRegion?: string): string {
  if (!regions || regions.length === 0) return 'Tokyo';
  if (regions.length === 1) return regions[0];
  
  let locationText = '';
  let titleText = '';
  let notesText = '';
  let linkText = '';
  let resolvedNameText = '';
  let resolvedAddressText = '';

  if (activity && typeof activity === 'object') {
    locationText = (activity.location || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    titleText = (activity.title || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    notesText = (activity.notes || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    linkText = ((activity.locationLink || '') + ' ' + (activity.link || '')).toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    resolvedNameText = (activity.resolvedName || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    resolvedAddressText = (activity.resolvedAddress || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
  } else if (typeof activity === 'string') {
    locationText = activity.toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
  }

  // 1. Direct substring check on location and resolved fields first
  if (locationText || resolvedNameText || resolvedAddressText) {
    for (const region of regions) {
      const regionLower = region.toLowerCase();
      if (
        (locationText && locationText.includes(regionLower)) ||
        (resolvedNameText && resolvedNameText.includes(regionLower)) ||
        (resolvedAddressText && resolvedAddressText.includes(regionLower))
      ) {
        return region;
      }
    }
  }

  // 2. Alias mapping check on location and resolved fields
  if (locationText || resolvedNameText || resolvedAddressText) {
    for (const region of regions) {
      const regionLower = region.toLowerCase();
      
      // Find matching alias configuration
      let aliases: string[] = [];
      for (const key of Object.keys(REGION_KEYWORD_MAP)) {
        if (regionLower.includes(key) || key.includes(regionLower)) {
          aliases = REGION_KEYWORD_MAP[key];
          break;
        }
      }
      
      // Check if any alias matches the location/resolved fields with word boundary protection for short codes
      for (const alias of aliases) {
        if (alias.length <= 3) {
          const regex = new RegExp(`\\b${alias}\\b`, 'i');
          if (
            (locationText && regex.test(locationText)) ||
            (resolvedNameText && regex.test(resolvedNameText)) ||
            (resolvedAddressText && regex.test(resolvedAddressText))
          ) {
            return region;
          }
        } else {
          if (
            (locationText && locationText.includes(alias)) ||
            (resolvedNameText && resolvedNameText.includes(alias)) ||
            (resolvedAddressText && resolvedAddressText.includes(alias))
          ) {
            return region;
          }
        }
      }
    }
  }

  // 3. Direct substring check on other fields (title, notes, links)
  for (const region of regions) {
    const regionLower = region.toLowerCase();
    if (titleText.includes(regionLower) || notesText.includes(regionLower) || linkText.includes(regionLower)) {
      return region;
    }
  }

  // 4. Alias mapping check on other fields (title, notes, links)
  for (const region of regions) {
    const regionLower = region.toLowerCase();
    
    let aliases: string[] = [];
    for (const key of Object.keys(REGION_KEYWORD_MAP)) {
      if (regionLower.includes(key) || key.includes(regionLower)) {
        aliases = REGION_KEYWORD_MAP[key];
        break;
      }
    }
    
    for (const alias of aliases) {
      if (alias.length <= 3) {
        const regex = new RegExp(`\\b${alias}\\b`, 'i');
        if (regex.test(titleText) || regex.test(notesText) || regex.test(linkText)) {
          return region;
        }
      } else {
        if (titleText.includes(alias) || notesText.includes(alias) || linkText.includes(alias)) {
          return region;
        }
      }
    }
  }
  if (previousRegion && regions.includes(previousRegion)) {
    return previousRegion;
  }
  
  return regions[0];
}

// Fallback advisory generator when both Ollama and Gemini are unavailable
function buildFallbackAdvisory(date: string, regions: string[], weatherList: any[], activities: any[]): string {
  const regionStr = regions.join(', ');
  const activityCount = activities.length;
  let weatherHint = '';
  const firstWeather = weatherList[0];
  if (firstWeather && firstWeather.tempMax > 0) {
    if (firstWeather.tempMax >= 80) weatherHint = 'It will be a warm day, so dress lightly and stay hydrated. ';
    else if (firstWeather.tempMax >= 65) weatherHint = 'Temperatures will be mild and comfortable. ';
    else weatherHint = 'It will be cool, so bring warm layers. ';
    if (firstWeather.precipProb > 40) weatherHint += 'Bring an umbrella in case of rain. ';
  }
  const activityHighlight = activityCount > 0 ? `You have ${activityCount} planned activities today.` : 'Enjoy a relaxed day.';
  return `Exploring ${regionStr} today. ${weatherHint}${activityHighlight} Check the itinerary below for all your plans!`;
}

export function buildAdvisoryPrompt(date: string, regions: string[], weatherList: any[], activities: any[]): string {
  let lastResolvedRegion = regions && regions.length > 0 ? regions[0] : 'Tokyo';

  const scheduleStr = activities
    .map((act: any) => {
      const timeStr = act.time || 'All Day';
      const location = act.location || 'N/A';
      
      const activityRegion = findBestRegionForActivity(act, regions, lastResolvedRegion);
      lastResolvedRegion = activityRegion;
      const regionIndex = regions.indexOf(activityRegion);
      const weather = regionIndex !== -1 ? weatherList[regionIndex] : weatherList[0];
      
      let weatherSuffix = '';
      if (weather) {
        const hour = parseTimeToHour(timeStr);
        if (weather.condition === 'Unknown') {
          weatherSuffix = ' (Weather: No Data / Forecast Unavailable)';
        } else if (hour !== null && weather.hourly && weather.hourly.length > hour) {
          const hourlyForecast = weather.hourly[hour];
          const temp = hourlyForecast.temp;
          const condition = hourlyForecast.condition || weather.condition;
          const emoji = hourlyForecast.emoji || weather.emoji;
          const precip = hourlyForecast.precipProb !== undefined ? hourlyForecast.precipProb : weather.precipProb;
          
          if (condition === 'Unknown') {
            weatherSuffix = ' (Weather: No Data / Forecast Unavailable)';
          } else {
            weatherSuffix = ` (Weather at ${timeStr}: ${temp}°F, ${condition} ${emoji}, precip prob ${precip}%)`;
          }
        } else {
          weatherSuffix = ` (Weather for the day: High ${weather.tempMax}°F, Low ${weather.tempMin}°F, ${weather.condition} ${weather.emoji}, precip prob ${weather.precipProb}%)`;
        }
      }
      
      return `- [${timeStr}] ${act.title} (${location})${weatherSuffix} - Category: ${act.category}. Notes: ${act.notes}`;
    })
    .join('\n');

  const weatherStr = weatherList.map((w, idx) => {
    if (w.condition === 'Unknown') {
      return `Region: ${regions[idx]}
- Forecast: No Data / Unavailable (Date too far in future or out of range)`;
    }
    return `Region: ${regions[idx]}
- Current Temperature: ${w.currentTemp}°F
- Expected High: ${w.tempMax}°F
- Expected Low: ${w.tempMin}°F
- General Condition: ${w.condition} ${w.emoji || ''}
- Precipitation Probability: ${w.precipProb}%
- Humidity: ${w.humidity}%
- Wind Speed: ${w.windSpeed} mph
`;
  }).join('\n');

  return `Today is ${date}. We are exploring the following regions in Japan: ${regions.join(', ')}.
Here is the weather forecast for today:
${weatherStr}
Our planned itinerary for today is:
${scheduleStr}

Please provide a highly concise, 2-3 sentence travel insight for our small group today. Blend weather preparation (outfit, shoes, umbrellas/sunscreen) across the different regions and itinerary details into one cohesive, friendly paragraph. Do NOT use bullet points, list numbers, sections, or markdown headers. Keep it very short so it fits in a small card.`;
}

export interface GenerationOptions {
  geminiApiKey?: string;
  geminiModel?: string;
  ollamaModel?: string;
  ollamaFallbackUrl?: string;
  ollamaFallbackModel?: string;
}

/**
 * Proactively generates the advisory note using local Gemma (gemma4:26b)
 * with a fallback to Gemini Flash if needed, and caches the result.
 */
export async function generateAdvisory(
  date: string,
  regions: string[],
  weatherList: any[],
  activities: any[],
  options?: GenerationOptions
): Promise<{ content: string; source: 'cache' | 'gemma' | 'gemini' }> {
  // Use just the date as the cache key since advisory is now full-day
  const cacheKey = `${date}`;
  const cache = loadAdvisorCache();

  // Return cached advice if already populated
  if (cache[cacheKey]) {
    console.log(`Generator: Cache hit for ${cacheKey}`);
    return { content: cache[cacheKey], source: 'cache' };
  }

  const prompt = buildAdvisoryPrompt(date, regions, weatherList, activities);

  // Ollama endpoints: primary (gaming GPU) and fallback (Mac Mini)
  const primaryOllamaUrl = 'http://192.168.50.182:11434/api/chat';
  const fallbackOllamaUrl = options?.ollamaFallbackUrl || 'http://192.168.50.133:11434/api/chat';

  let primaryModel = options?.ollamaModel || 'gemma4:26b';
  if (!primaryModel.startsWith('gemma4')) {
    console.log(`Generator: Remapping outdated primary model '${primaryModel}' to 'gemma4:26b'`);
    primaryModel = 'gemma4:26b';
  }

  let fallbackModel = options?.ollamaFallbackModel || 'gemma4:e4b';
  if (!fallbackModel.startsWith('gemma4')) {
    console.log(`Generator: Remapping outdated fallback model '${fallbackModel}' to 'gemma4:e4b'`);
    fallbackModel = 'gemma4:e4b';
  }

  // Try each Ollama endpoint with its mapped model in order
  const ollamaConfigs = [
    { url: primaryOllamaUrl, model: primaryModel },
    { url: fallbackOllamaUrl, model: fallbackModel }
  ];
  
  for (const config of ollamaConfigs) {
    const { url: ollamaUrl, model: modelName } = config;
    if (!(await isOllamaOnline(ollamaUrl))) {
      console.log(`Generator: Skipping offline Ollama at ${ollamaUrl}`);
      continue;
    }
    const gemmaController = new AbortController();
    const gemmaTimeout = setTimeout(() => gemmaController.abort(), 30000);

    try {
      console.log(`Generator: Attempting advisory generation with Ollama at ${ollamaUrl} using model ${modelName} for ${cacheKey}`);
      const gemmaResponse = await fetch(ollamaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          stream: false
        }),
        signal: gemmaController.signal
      });

      clearTimeout(gemmaTimeout);

      if (gemmaResponse.ok) {
        const resData = (await gemmaResponse.json()) as any;
        const content = resData?.message?.content;
        if (content) {
          cache[cacheKey] = content;
          saveAdvisorCache(cache);
          const sourceName = ollamaUrl === primaryOllamaUrl ? 'gemma' : 'gemma-fallback';
          console.log(`Generator: Successfully generated advisor using ${sourceName} for ${cacheKey}`);
          return { content, source: sourceName as 'cache' | 'gemma' | 'gemini' };
        }
      }
      throw new Error(`Ollama at ${ollamaUrl} returned non-ok status: ${gemmaResponse.statusText} (${gemmaResponse.status})`);
    } catch (ollamaErr: any) {
      clearTimeout(gemmaTimeout);
      console.warn(`Generator: Ollama at ${ollamaUrl} failed/timed out. Error: ${ollamaErr.message || ollamaErr}. Trying next fallback...`);
    }
  }

  console.warn(`Generator: All Ollama endpoints failed. Trying Gemini fallback...`);

  // 2. Fallback to Gemini Flash
    const apiKey = process.env.GEMINI_API_KEY || options?.geminiApiKey;
    if (!apiKey) {
      console.warn('Generator: No Gemini API key available. Generating basic fallback advisory...');
      // Graceful fallback: generate a simple advisory from the itinerary data
      const fallbackContent = buildFallbackAdvisory(date, regions, weatherList, activities);
      cache[cacheKey] = fallbackContent;
      saveAdvisorCache(cache);
      console.log(`Generator: Saved basic fallback advisory for ${cacheKey}`);
      return { content: fallbackContent, source: 'gemma' };
    }

    const model = options?.geminiModel || 'gemini-2.5-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const geminiController = new AbortController();
    const geminiTimeout = setTimeout(() => geminiController.abort(), 10000);

    try {
      console.log(`Generator: Querying Gemini API fallback model ${model} for ${cacheKey}`);
      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        }),
        signal: geminiController.signal
      });

      clearTimeout(geminiTimeout);

      if (!geminiResponse.ok) {
        const errText = await geminiResponse.text();
        throw new Error(`Gemini API error (${geminiResponse.status}): ${errText}`);
      }

      const resData = (await geminiResponse.json()) as any;
      const content = resData?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (content) {
        cache[cacheKey] = content;
        saveAdvisorCache(cache);
        console.log(`Generator: Successfully generated advisor using Gemini Flash fallback for ${cacheKey}`);
        return { content, source: 'gemini' };
      }

      throw new Error('Gemini API response did not contain candidates or content text.');
    } catch (geminiErr: any) {
      clearTimeout(geminiTimeout);
      console.error('Generator: Both Gemma and Gemini fallback failed.', geminiErr);
      throw new Error(`Both Gemma and Gemini fallback failed: ${geminiErr.message || geminiErr}`);
    }
  }

const regionsCacheFile = path.join(__dirname, '..', 'regions_cache.json');

function loadRegionsCache(): Record<string, string[]> {
  if (fs.existsSync(regionsCacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(regionsCacheFile, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveRegionsCache(cache: Record<string, string[]>) {
  fs.writeFileSync(regionsCacheFile, JSON.stringify(cache, null, 2), 'utf8');
}

export function buildRegionExtractionPrompt(date: string, activities: any[]): string {
  return `Analyze the following itinerary activities for ${date}.
Extract the primary broad city or municipality names (e.g., Tokyo, Osaka, Kyoto, Mount Fuji).
Return ONLY a valid JSON array of strings representing the cities visited on this day.
Do not include any markdown formatting, explanations, or text other than the JSON array.
If the itinerary is empty or the location is unknown, return ["Tokyo"].

Activities:
${activities.map(a => `- ${a.title} at ${a.location}`).join('\n')}
`;
}

// Extract regions dynamically via LLM
async function extractRegionsForDayRaw(
  date: string,
  activities: any[],
  options?: GenerationOptions
): Promise<string[]> {
  if (!activities || activities.length === 0) return ["Tokyo"];

  const cache = loadRegionsCache();
  if (cache[date]) {
    return cache[date];
  }

  const prompt = buildRegionExtractionPrompt(date, activities);

  // Ollama endpoints: primary (gaming GPU) and fallback (Mac Mini)
  const primaryOllamaUrl = 'http://192.168.50.182:11434/api/chat';
  const fallbackOllamaUrl = options?.ollamaFallbackUrl || 'http://192.168.50.133:11434/api/chat';

  let primaryModel = options?.ollamaModel || 'gemma4:26b';
  if (!primaryModel.startsWith('gemma4')) {
    primaryModel = 'gemma4:26b';
  }

  let fallbackModel = options?.ollamaFallbackModel || 'gemma4:e4b';
  if (!fallbackModel.startsWith('gemma4')) {
    fallbackModel = 'gemma4:e4b';
  }

  const ollamaConfigs = [
    { url: primaryOllamaUrl, model: primaryModel },
    { url: fallbackOllamaUrl, model: fallbackModel }
  ];

  for (const config of ollamaConfigs) {
    const { url: ollamaUrl, model: modelName } = config;
    if (!(await isOllamaOnline(ollamaUrl))) {
      console.log(`Generator: Skipping offline Ollama at ${ollamaUrl}`);
      continue;
    }
    const gemmaController = new AbortController();
    const gemmaTimeout = setTimeout(() => gemmaController.abort(), 10000);

    try {
      const gemmaResponse = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          stream: false
        }),
        signal: gemmaController.signal
      });

      clearTimeout(gemmaTimeout);

      if (gemmaResponse.ok) {
        const resData = (await gemmaResponse.json()) as any;
        const content = resData?.message?.content || "";
        try {
          const parsed = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
          if (Array.isArray(parsed) && parsed.length > 0) {
            cache[date] = parsed;
            saveRegionsCache(cache);
            return parsed;
          }
        } catch (e) {
          console.warn(`Ollama at ${ollamaUrl} failed to return valid JSON array:`, content);
        }
      }
    } catch (ollamaErr) {
      clearTimeout(gemmaTimeout);
      console.warn(`Ollama at ${ollamaUrl} failed for region extraction. Trying next fallback...`);
    }
  }

  // Fallback to Gemini
  const apiKey = process.env.GEMINI_API_KEY || options?.geminiApiKey;
  if (!apiKey) return ["Tokyo"]; // Safe generic fallback

  const model = options?.geminiModel || 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const geminiController = new AbortController();
  const geminiTimeout = setTimeout(() => geminiController.abort(), 15000);

  try {
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      }),
      signal: geminiController.signal
    });

    clearTimeout(geminiTimeout);

    if (geminiResponse.ok) {
      const resData = (await geminiResponse.json()) as any;
      const content = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (content) {
        try {
          const parsed = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
          if (Array.isArray(parsed) && parsed.length > 0) {
            cache[date] = parsed;
            saveRegionsCache(cache);
            return parsed;
          }
        } catch (e) {
          console.warn("Gemini failed to return valid JSON array:", content);
        }
      }
    }
  } catch (geminiErr) {
    clearTimeout(geminiTimeout);
    console.error("Gemini failed for region extraction:", geminiErr);
  }

  return ["Tokyo"]; // Final fallback
}

export async function extractRegionsForDay(
  date: string,
  activities: any[],
  options?: GenerationOptions
): Promise<string[]> {
  const rawRegions = await extractRegionsForDayRaw(date, activities, options);
  return addImplicitRegions(rawRegions, activities);
}


export function buildBulkRegionExtractionPrompt(days: any[]): string {
  let daysText = '';
  days.forEach(day => {
    daysText += `Date: ${day.date}\n`;
    day.activities.forEach((a: any) => {
      daysText += `- ${a.title} at ${a.location}\n`;
    });
    daysText += '\n';
  });

  return `Analyze the following itinerary activities for multiple days.
For each date, extract the primary broad city or municipality names (e.g., Tokyo, Osaka, Kyoto, Mount Fuji).
Return ONLY a valid JSON dictionary where the keys are the dates (exact strings as provided) and the values are arrays of strings representing the cities visited on that day.
Do not include any markdown formatting, explanations, or text other than the JSON dictionary.
If a day has no activities or location is unknown, output ["Tokyo"] for that day.

Itinerary:
${daysText}
`;
}

function robustJsonParse(text: string): any {
  if (!text) return null;
  // First, try standard parsing just in case it's clean
  try {
    return JSON.parse(text);
  } catch (e) {}

  // Strip markdown code blocks
  const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleanText);
  } catch (e) {}

  // Fallback: extract the outermost JSON object or array
  const startObj = cleanText.indexOf('{');
  const startArr = cleanText.indexOf('[');
  
  let start = -1;
  let end = -1;
  
  if (startObj !== -1 && (startArr === -1 || startObj < startArr)) {
    start = startObj;
    end = cleanText.lastIndexOf('}');
  } else if (startArr !== -1) {
    start = startArr;
    end = cleanText.lastIndexOf(']');
  }
  
  if (start !== -1 && end !== -1 && end >= start) {
    try {
      return JSON.parse(cleanText.substring(start, end + 1));
    } catch (e) {}
  }
  
  return null;
}

// Extract all regions for the itinerary dynamically via a single LLM call
async function extractBulkRegionsRaw(
  days: any[],
  options?: GenerationOptions
): Promise<Record<string, string[]>> {
  const cache = loadRegionsCache();
  const regionsMap: Record<string, string[]> = {};
  const uncachedDays: any[] = [];

  // Check cache first
  for (const day of days) {
    if (cache[day.date]) {
      regionsMap[day.date] = cache[day.date];
    } else {
      uncachedDays.push(day);
    }
  }

  // If all days are cached, return immediately
  if (uncachedDays.length === 0) {
    return regionsMap;
  }

  const prompt = buildBulkRegionExtractionPrompt(uncachedDays);

  // Ollama endpoints: primary (gaming GPU) and fallback (Mac Mini)
  const primaryOllamaUrl = 'http://192.168.50.182:11434/api/chat';
  const fallbackOllamaUrl = options?.ollamaFallbackUrl || 'http://192.168.50.133:11434/api/chat';

  let primaryModel = options?.ollamaModel || 'gemma4:26b';
  if (!primaryModel.startsWith('gemma4')) {
    primaryModel = 'gemma4:26b';
  }

  let fallbackModel = options?.ollamaFallbackModel || 'gemma4:e4b';
  if (!fallbackModel.startsWith('gemma4')) {
    fallbackModel = 'gemma4:e4b';
  }

  const ollamaConfigs = [
    { url: primaryOllamaUrl, model: primaryModel },
    { url: fallbackOllamaUrl, model: fallbackModel }
  ];

  for (const config of ollamaConfigs) {
    const { url: ollamaUrl, model: modelName } = config;
    if (!(await isOllamaOnline(ollamaUrl))) {
      console.log(`Generator: Skipping offline Ollama at ${ollamaUrl}`);
      continue;
    }
    const gemmaController = new AbortController();
    // Allow more time for bulk extraction
    const gemmaTimeout = setTimeout(() => gemmaController.abort(), 30000);

    try {
      const gemmaResponse = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          stream: false
        }),
        signal: gemmaController.signal
      });

      clearTimeout(gemmaTimeout);

      if (gemmaResponse.ok) {
        const resData = (await gemmaResponse.json()) as any;
        const content = resData?.message?.content || "";
        const parsed = robustJsonParse(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // Merge newly extracted days into our map and cache
          for (const [dayDate, regions] of Object.entries(parsed)) {
            if (Array.isArray(regions)) {
              regionsMap[dayDate] = regions as string[];
              cache[dayDate] = regions as string[];
            }
          }
          saveRegionsCache(cache);
          
          // Ensure all requested days have a fallback if LLM missed them
          for (const day of uncachedDays) {
            if (!regionsMap[day.date]) regionsMap[day.date] = ["Tokyo"];
          }
          return regionsMap;
        } else if (content) {
          console.warn(`Ollama at ${ollamaUrl} failed to return valid JSON object:`, content);
        }
      }
    } catch (ollamaErr) {
      clearTimeout(gemmaTimeout);
      console.warn(`Ollama at ${ollamaUrl} failed for bulk region extraction. Trying next fallback...`);
    }
  }

  // Fallback to Gemini
  const apiKey = process.env.GEMINI_API_KEY || options?.geminiApiKey;
  if (!apiKey) {
    // Fill remaining with safe fallback
    uncachedDays.forEach(day => regionsMap[day.date] = ["Tokyo"]);
    return regionsMap;
  }

  const model = options?.geminiModel || 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const geminiController = new AbortController();
  const geminiTimeout = setTimeout(() => geminiController.abort(), 30000);

  try {
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      }),
      signal: geminiController.signal
    });

    clearTimeout(geminiTimeout);

    if (geminiResponse.ok) {
      const resData = (await geminiResponse.json()) as any;
      const content = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (content) {
        const parsed = robustJsonParse(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // Merge newly extracted days into our map and cache
          for (const [date, regions] of Object.entries(parsed)) {
            if (Array.isArray(regions)) {
              regionsMap[date] = regions as string[];
              cache[date] = regions as string[];
            }
          }
          saveRegionsCache(cache);
          
          // Ensure all requested days have a fallback if LLM missed them
          for (const day of uncachedDays) {
            if (!regionsMap[day.date]) regionsMap[day.date] = ["Tokyo"];
          }
          return regionsMap;
        } else {
          console.warn("Gemini failed to return valid JSON object:", content);
        }
      }
    }
  } catch (geminiErr) {
    clearTimeout(geminiTimeout);
    console.error("Gemini failed for bulk region extraction:", geminiErr);
  }

  // Fill remaining with safe fallback
  uncachedDays.forEach(day => regionsMap[day.date] = ["Tokyo"]);
  return regionsMap;
}

export async function extractBulkRegions(
  days: any[],
  options?: GenerationOptions
): Promise<Record<string, string[]>> {
  const rawRegionsMap = await extractBulkRegionsRaw(days, options);
  const enrichedMap: Record<string, string[]> = {};
  for (const day of days) {
    if (rawRegionsMap[day.date]) {
      enrichedMap[day.date] = addImplicitRegions(rawRegionsMap[day.date], day.activities);
    } else {
      enrichedMap[day.date] = addImplicitRegions(["Tokyo"], day.activities);
    }
  }
  return enrichedMap;
}

