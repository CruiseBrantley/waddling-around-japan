import type { ItineraryActivity } from '../services/sheets';

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

import { getApiUrl } from './api';

// Dynamically fetches resolved regions for the day from the backend LLM pipeline
export async function fetchRegionsForDay(activities: ItineraryActivity[], dateStr: string): Promise<string[]> {
  try {
    const apiUrl = getApiUrl();
    const response = await fetch(`${apiUrl}/regions`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify({ date: dateStr, activities })
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.regions && Array.isArray(data.regions)) {
        return data.regions;
      }
    }
  } catch (e) {
    console.error('Failed to fetch dynamic regions:', e);
  }
  
  return ['Tokyo']; // Fallback if the network or LLM fails
}
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

// Generate realistic simulated climate conditions for late May/early June in Japan (FALLBACK)
export function getWeatherData(region: string, _dateStr: string, _currentTime: Date): WeatherData {
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
