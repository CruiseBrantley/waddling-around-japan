import type { ItineraryActivity } from '../services/sheets';
import type { WeatherData } from './weather';
import { getApiUrl } from './api';
import { parseTimeToHour } from './time';

export interface AIAdvisoryRequest {
  date: string;
  region: string;
  weather: WeatherData;
  activities: ItineraryActivity[];
  provider: 'none' | 'gemini' | 'gemma';
  geminiApiKey: string;
  geminiModel: string;
  ollamaUrl: string;
  ollamaModel: string;
}

// Formulates a highly concise, 2-3 sentence travel insight blending weather prep and timeline activities
export function buildAdvisoryPrompt(request: AIAdvisoryRequest): string {
  const { date, region, weather, activities } = request;
  
  const scheduleStr = activities
    .map(act => {
      const timeStr = act.time || 'All Day';
      const location = act.location || 'N/A';
      
      let weatherSuffix = '';
      if (weather) {
        const hour = parseTimeToHour(timeStr);
        if (hour !== null && weather.hourly && weather.hourly.length > hour) {
          const hourlyForecast = weather.hourly[hour];
          const temp = hourlyForecast.temp;
          const condition = hourlyForecast.condition || weather.condition;
          const emoji = hourlyForecast.emoji || weather.emoji;
          const precip = hourlyForecast.precipProb !== undefined ? hourlyForecast.precipProb : weather.precipProb;
          
          weatherSuffix = ` (Weather at ${timeStr}: ${temp}°F, ${condition} ${emoji}, precip prob ${precip}%)`;
        } else {
          weatherSuffix = ` (Weather for the day: High ${weather.tempMax}°F, Low ${weather.tempMin}°F, ${weather.condition} ${weather.emoji}, precip prob ${weather.precipProb}%)`;
        }
      }
      
      return `- [${timeStr}] ${act.title} (${location})${weatherSuffix} - Category: ${act.category}. Notes: ${act.notes}`;
    })
    .join('\n');

  return `Today is ${date}. We are exploring the ${region} region in Japan.
Here is the weather forecast for ${region} today:
- Current Temperature: ${weather.currentTemp}°F
- Expected High: ${weather.tempMax}°F
- Expected Low: ${weather.tempMin}°F
- General Condition: ${weather.condition} ${weather.emoji}
- Precipitation Probability: ${weather.precipProb}%
- Humidity: ${weather.humidity}%
- Wind Speed: ${Math.round(weather.windSpeed * 0.621371)} mph

Our planned itinerary for today is:
${scheduleStr}

Please provide a highly concise, 2-3 sentence travel insight for our small group today. Blend weather preparation (outfit, shoes, umbrellas/sunscreen) and itinerary details into one cohesive, friendly paragraph. Do NOT use bullet points, list numbers, sections, or markdown headers. Keep it very short so it fits in a small card.`;
}

// Main execution function fetching remote PC Gemma 3.5 response client-side with cache fallback
export async function fetchAIAdvisory(request: AIAdvisoryRequest): Promise<string> {
  const { date, region, provider, geminiApiKey, geminiModel, ollamaModel } = request;
  
  // 1. Check local cache first
  const cacheKey = `ai_advisory_${date.replace(/[^a-zA-Z0-9]/g, '_')}_${region.toLowerCase()}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      console.log('AI: Loaded generated advisory from LocalStorage cache.');
      return cached;
    }
  } catch (e) {
    console.warn('AI: Cache load failed:', e);
  }

  // If AI daily insights are disabled
  if (provider === 'none') {
    throw new Error('AI travel insights are disabled.');
  }

  const apiUrl = getApiUrl();

  // 3. Ask the server to generate (since only the server has access to local Gemma and fallback)
  console.log(`AI: Requesting push server to generate advisory via Gemma/Gemini...`);
  const genRes = await fetch(`${apiUrl}/advisor/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      'Bypass-Tunnel-Reminder': 'true'
    },
    body: JSON.stringify({
      date,
      region,
      weather: request.weather,
      activities: request.activities,
      geminiApiKey,
      geminiModel,
      ollamaModel
    })
  });

  if (!genRes.ok) {
    const errData = await genRes.json().catch(() => ({}));
    throw new Error(errData.error || `Server failed to generate advisory: ${genRes.statusText} (${genRes.status})`);
  }

  const genData = await genRes.json();
  const content = genData.content;
  if (!content) {
    throw new Error('Received empty content from advisor generator.');
  }

  // Save to local cache
  try {
    localStorage.setItem(cacheKey, content);
  } catch (e) {
    console.warn('AI: Failed to cache response:', e);
  }

  return content;
}

