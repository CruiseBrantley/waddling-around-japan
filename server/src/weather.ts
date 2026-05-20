import { ItineraryActivity } from './sheets';
import fs from 'fs';
import path from 'path';

export interface WeatherData {
  region: string;
  tempMin: number;
  tempMax: number;
  condition: string;
  emoji: string;
  precipProb: number;
  humidity: number;
  windSpeed: number;
  advisory: string;
  currentTemp: number;
  hourly: { hour: number; temp: number; emoji: string }[];
}

interface LatLon {
  latitude: number;
  longitude: number;
}

const GEOCODING_CACHE_FILE = path.join(__dirname, '..', 'geocoding_cache.json');

function loadGeocodingCache(): Record<string, LatLon> {
  if (fs.existsSync(GEOCODING_CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(GEOCODING_CACHE_FILE, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveGeocodingCache(cache: Record<string, LatLon>) {
  try {
    fs.writeFileSync(GEOCODING_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('Server Weather Cache: Failed to save geocoding cache', e);
  }
}

export async function getCoordinatesForRegion(regionName: string): Promise<LatLon | null> {
  const cache = loadGeocodingCache();
  const normalizedKey = regionName.toLowerCase();
  
  if (cache[normalizedKey]) {
    return cache[normalizedKey];
  }

  try {
    console.log(`Server Weather Service: Geocoding ${regionName}...`);
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(regionName)}&count=1&language=en&format=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Geocoding failed: ${response.status}`);
    
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      const coords = {
        latitude: data.results[0].latitude,
        longitude: data.results[0].longitude
      };
      cache[normalizedKey] = coords;
      saveGeocodingCache(cache);
      return coords;
    }
  } catch (e) {
    console.error(`Failed to geocode region: ${regionName}`, e);
  }
  
  return null;
}

// Maps Open-Meteo WMO weather codes to our conditions and emojis
function mapWMOToCondition(code: number): { condition: string; emoji: string; advisory: string } {
  if (code === 0) {
    return {
      condition: 'Sunny',
      emoji: '☀️',
      advisory: '☀️ Warm and bright! Great for walking or outdoor events. Stay hydrated.'
    };
  }
  if (code === 1 || code === 2) {
    return {
      condition: 'Partly Cloudy',
      emoji: '⛅',
      advisory: '⛅ Slightly humid but perfect for walking and exploring. Wear light fabrics.'
    };
  }
  if (code === 3) {
    return {
      condition: 'Cloudy',
      emoji: '☁️',
      advisory: '☁️ Overcast skies. A comfortable day for walking without harsh sunlight.'
    };
  }
  if (code === 45 || code === 48) {
    return {
      condition: 'Foggy',
      emoji: '🌫️',
      advisory: '🌫️ Foggy conditions. Visibility is reduced, proceed carefully on paths.'
    };
  }
  if ([51, 53, 55, 56, 57].includes(code)) {
    return {
      condition: 'Drizzle',
      emoji: '🌦️',
      advisory: '🌦️ Light drizzle in the air. Carrying a light umbrella or windbreaker is wise.'
    };
  }
  if ([61, 63, 65, 66, 67].includes(code)) {
    return {
      condition: 'Rainy',
      emoji: '🌧️',
      advisory: '🌧️ Steady rain. Ideal for indoor museums or shopping centers. Bring an umbrella!'
    };
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return {
      condition: 'Snowy',
      emoji: '❄️',
      advisory: '❄️ Cold snowy conditions. Dress in warm layers and wear insulated boots.'
    };
  }
  if ([80, 81, 82].includes(code)) {
    return {
      condition: 'Rain Showers',
      emoji: '🌦️',
      advisory: '☔ Scattered rain showers. Carry a portable umbrella for shrines!'
    };
  }
  if ([95, 96, 99].includes(code)) {
    return {
      condition: 'Thunderstorm',
      emoji: '⛈️',
      advisory: '⛈️ Thunderstorms likely. Stay indoors if lightning gets close!'
    };
  }
  return {
    condition: 'Clear',
    emoji: '☀️',
    advisory: 'Perfect weather for sightseeing! Dress in comfortable clothing.'
  };
}

export function parseDateStrToYYYYMMDD(dateStr: string): string | null {
  if (dateStr.includes('-')) {
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return parts.join('-');
    }
  }
  const cleanStr = dateStr.replace(/^[A-Za-z]+,\s*/, '');
  const match = cleanStr.match(/^(\d+)\/(\d+)\/(\d+)/);
  if (match) {
    const month = match[1].padStart(2, '0');
    const day = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    return `${year}-${month}-${day}`;
  }
  return null;
}

// Helper to parse day from date string robustly (e.g. "Sun, 5/24/26" -> Day 1 of trip)

// Computes dynamic temperature based on high/low bounds and the current hour (diurnal curve)
export function getDiurnalTemperature(low: number, high: number, hour: number): number {
  let factor = 0;
  if (hour >= 5 && hour < 15) {
    // 10 hour rise from 5:00 AM to 3:00 PM
    factor = Math.sin(((hour - 5) / 10) * (Math.PI / 2)) ** 2;
  } else {
    // 14 hour fall from 3:00 PM to 5:00 AM next day
    const normalizedHour = hour < 5 ? hour + 24 : hour;
    factor = Math.cos(((normalizedHour - 15) / 14) * (Math.PI / 2)) ** 2;
  }
  return Math.round(low + (high - low) * factor);
}

export function getWeatherData(region: string, dateStr: string, currentTime: Date): WeatherData {
  // Return a generic "Out of Range" response for dates too far in the future
  return {
    region,
    tempMin: 0,
    tempMax: 0,
    condition: 'Unknown',
    emoji: '📅',
    precipProb: 0,
    humidity: 0,
    windSpeed: 0,
    advisory: 'Forecast unavailable: Date is too far out. Check back closer to your trip!',
    currentTemp: 0,
    hourly: []
  };
}

interface WeatherCacheEntry {
  fetchedAt: number;
  forecastData: any;
}

const WEATHER_CACHE_FILE = path.join(__dirname, '..', 'weather_cache.json');

function loadWeatherCache(): Record<string, WeatherCacheEntry> {
  if (fs.existsSync(WEATHER_CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(WEATHER_CACHE_FILE, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveWeatherCache(cache: Record<string, WeatherCacheEntry>) {
  try {
    fs.writeFileSync(WEATHER_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('Server Weather Cache: Failed to save weather cache', e);
  }
}

export async function asyncGetWeatherData(region: string, dateStr: string, currentTime: Date): Promise<WeatherData> {
  const fallback = getWeatherData(region, dateStr, currentTime);
  
  if (process.env.NODE_ENV === 'test') {
    return fallback;
  }

  const coords = await getCoordinatesForRegion(region);
  const targetDate = parseDateStrToYYYYMMDD(dateStr);

  if (!coords || !targetDate) {
    console.log(`Server Weather Service: No coordinates or target date found for ${region} on ${dateStr}. Using generic out-of-range response.`);
    return fallback;
  }

  const cache = loadWeatherCache();
  const cacheKey = region.toLowerCase();
  const oneHourAgo = Date.now() - 3600000;
  
  let forecastData = cache[cacheKey]?.fetchedAt > oneHourAgo ? cache[cacheKey].forecastData : null;

  if (!forecastData) {
    try {
      console.log(`Server Weather Service: Fetching live weather forecast for ${region} (${coords.latitude}, ${coords.longitude})`);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=Asia%2FTokyo&forecast_days=16`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Open-Meteo request failed with status ${response.status}`);
      }
      const data = await response.json();
      
      cache[cacheKey] = {
        fetchedAt: Date.now(),
        forecastData: data
      };
      saveWeatherCache(cache);
      forecastData = data;
    } catch (e: any) {
      console.warn(`Server Weather Service: Failed to fetch live weather for ${region}. Error: ${e.message || e}. Attempting expired cache fallback.`);
      forecastData = cache[cacheKey]?.forecastData || null;
    }
  }

  if (!forecastData || !forecastData.daily || !forecastData.hourly) {
    console.log(`Server Weather Service: No live forecast data available for ${region}. Using generic out-of-range response.`);
    return fallback;
  }

  // Find target date index in daily forecast
  const dailyIndex = forecastData.daily.time.indexOf(targetDate);
  if (dailyIndex === -1) {
    console.log(`Server Weather Service: Date ${targetDate} is out of the 16-day forecast range for ${region}. Using generic out-of-range response.`);
    return fallback;
  }

  const tempMin = Math.round(forecastData.daily.temperature_2m_min[dailyIndex]);
  const tempMax = Math.round(forecastData.daily.temperature_2m_max[dailyIndex]);
  const dailyCode = forecastData.daily.weather_code[dailyIndex];
  
  const mapped = mapWMOToCondition(dailyCode);
  const condition = mapped.condition;
  const emoji = mapped.emoji;
  let advisory = mapped.advisory;

  // Find hourly index matching targetDateT00:00 to targetDateT23:00
  const hourlyTimes = forecastData.hourly.time as string[];
  const startIndex = hourlyTimes.findIndex(t => t.startsWith(`${targetDate}T00:00`));

  if (startIndex === -1) {
    console.log(`Server Weather Service: Hourly times for ${targetDate} not found. Using generic out-of-range response.`);
    return fallback;
  }

  const hourly: { hour: number; temp: number; emoji: string }[] = [];
  let humiditySum = 0;
  let windSpeedSum = 0;
  let precipProbMax = 0;

  for (let h = 0; h < 24; h++) {
    const idx = startIndex + h;
    const temp = Math.round(forecastData.hourly.temperature_2m[idx]);
    const hourlyCode = forecastData.hourly.weather_code[idx];
    
    let hourlyEmoji = mapWMOToCondition(hourlyCode).emoji;
    // Keep standard nighttime emojis matching diurnal code if clear/sunny
    if (h < 5 || h >= 19) {
      if (hourlyEmoji === '☀️') {
        hourlyEmoji = '🌙';
      }
    }

    hourly.push({
      hour: h,
      temp,
      emoji: hourlyEmoji
    });

    humiditySum += forecastData.hourly.relative_humidity_2m[idx] || 0;
    windSpeedSum += forecastData.hourly.wind_speed_10m[idx] || 0;
    precipProbMax = Math.max(precipProbMax, forecastData.hourly.precipitation_probability[idx] || 0);
  }

  const humidity = Math.round(humiditySum / 24);
  const windSpeed = Math.round(windSpeedSum / 24);
  const precipProb = Math.round(precipProbMax);

  // Calculate current hourly temp
  const hour = currentTime.getHours();
  const currentTemp = hourly[hour]?.temp ?? getDiurnalTemperature(tempMin, tempMax, hour);

  return {
    region,
    tempMin,
    tempMax,
    condition,
    emoji,
    precipProb,
    humidity,
    windSpeed,
    advisory,
    currentTemp,
    hourly
  };
}

