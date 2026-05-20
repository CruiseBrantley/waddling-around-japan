import fs from 'fs';
import path from 'path';

// Set up the advisor cache file path
let advisorCacheFile = path.join(__dirname, '..', 'advisor_cache.json');

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

// Helper to build prompt for AI travel advisor
export function buildAdvisoryPrompt(date: string, regions: string[], weatherList: any[], activities: any[]): string {
  const scheduleStr = activities
    .map((act: any) => `- [${act.time || 'All Day'}] ${act.title} (${act.location || 'N/A'}) - Category: ${act.category}. Notes: ${act.notes}`)
    .join('\n');

  const weatherStr = weatherList.map((w, idx) => {
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
  const fallbackOllamaUrl = options?.ollamaFallbackUrl || 'http://192.168.50.135:11434/api/chat';
  
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
      const errMsg = 'Generator: Gemma failed, and no Gemini API key was provided for fallback.';
      console.error(errMsg);
      throw new Error(errMsg);
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

let regionsCacheFile = path.join(__dirname, '..', 'regions_cache.json');

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
export async function extractRegionsForDay(
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
  const fallbackOllamaUrl = options?.ollamaFallbackUrl || 'http://192.168.50.135:11434/api/chat';
  
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
  let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
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
export async function extractBulkRegions(
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
  const fallbackOllamaUrl = options?.ollamaFallbackUrl || 'http://192.168.50.135:11434/api/chat';
  
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
