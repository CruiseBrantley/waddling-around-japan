export interface ItineraryActivity {
  id: string;
  date: string;
  time: string;
  title: string;
  location: string;
  link?: string;
  cost?: string;
  notes: string;
  category: string;
  requiresReservation?: boolean;
  type: "sightseeing" | "food" | "transport" | "accommodation" | "shopping" | "other";
}

export interface ItineraryDay {
  day: number;
  date: string;
  activities: ItineraryActivity[];
}

export interface Itinerary {
  title: string;
  days: ItineraryDay[];
}

interface SheetRow {
  values?: Array<{
    formattedValue?: string;
    hyperlink?: string;
    userEnteredFormat?: {
      backgroundColor?: {
        red?: number;
        green?: number;
        blue?: number;
      };
    };
  }>;
}

import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join(__dirname, '..', 'itinerary_cache.json');

/**
 * Fetch itinerary data from Google Sheets V4 API
 */
export async function fetchItinerary(): Promise<Itinerary> {
  const API_KEY = process.env.VITE_GOOGLE_SHEETS_API_KEY;
  const SPREADSHEET_ID = process.env.VITE_GOOGLE_SHEET_ID;
  const RANGE = process.env.VITE_GOOGLE_SHEET_NAME || 'Itinerary';

  if (!API_KEY || !SPREADSHEET_ID) {
    throw new Error("Google Sheets API Key or Spreadsheet ID is missing in environment variables");
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?includeGridData=true&ranges=${encodeURIComponent(RANGE)}&key=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Sheets API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const sheetData = data.sheets?.[0]?.data?.[0]?.rowData;
    if (!sheetData) {
      throw new Error("No data found in the spreadsheet range.");
    }

    const itinerary = transformFullSheetData(sheetData);
    
    // Save to server-side cache for offline resilience
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(itinerary, null, 2));
    } catch (e) {
      console.warn("Failed to write itinerary cache file:", e);
    }
    
    return itinerary;
  } catch (error) {
    console.warn("Server: Sheets fetch failed, checking local cache...", error);
    
    if (fs.existsSync(CACHE_FILE)) {
      try {
        const cachedData = fs.readFileSync(CACHE_FILE, 'utf8');
        console.log("Server: Using cached itinerary data from Disk.");
        return JSON.parse(cachedData);
      } catch (e) {
        console.error("Server: Failed to read itinerary cache file:", e);
      }
    }
    
    throw error;
  }
}

/**
 * Transform Full Spreadsheet API response into structured itinerary
 */
export function transformFullSheetData(rowData: SheetRow[]): Itinerary {
  if (!rowData || rowData.length < 5) {
    return { title: "Waddling Around Japan", days: [] };
  }

  const headerCells = rowData[2]?.values || [];
  const headerRow = headerCells.map((c) => String(c?.formattedValue || "").trim());
  const startRowIndex = 4;
  
  const colIndex = {
    date: headerRow.findIndex((h: string) => h.toLowerCase() === 'date'),
    time: headerRow.findIndex((h: string) => h.toLowerCase() === 'time'),
    activity: headerRow.findIndex((h: string) => h.toLowerCase() === 'activity'),
    location: headerRow.findIndex((h: string) => h.toLowerCase() === 'location'),
    link: headerRow.findIndex((h: string) => h.toLowerCase() === 'link' || h.toLowerCase() === 'type' || h.toLowerCase() === 'url'),
    cost: headerRow.findIndex((h: string) => h.toLowerCase() === 'cost'),
    notes: headerRow.findIndex((h: string) => h.toLowerCase() === 'notes'),
    category: headerRow.findIndex((h: string) => {
      const l = h.toLowerCase();
      return l === 'category' || l === 'type' || l === 'tag';
    }),
  };

  const daysMap = new Map<string, ItineraryActivity[]>();
  let lastValidDate = "";

  rowData.slice(startRowIndex).forEach((rowObj, index) => {
    const cells = rowObj.values || [];
    if (cells.length <= Math.max(colIndex.activity, colIndex.date)) return;

    const activityTitle = String(cells[colIndex.activity]?.formattedValue || "").trim();
    if (!activityTitle) return;

    let activityDate = String(cells[colIndex.date]?.formattedValue || "").trim();
    
    if (!activityDate && lastValidDate) {
      activityDate = lastValidDate;
    } else if (activityDate) {
      lastValidDate = activityDate;
    }

    if (!activityDate) return;

    const rawCategory = String(cells[colIndex.category]?.formattedValue || "").trim();
    const inferredCategory = inferCategory(activityTitle, rawCategory);

    const hyperLink = cells[colIndex.link]?.hyperlink;
    const formattedLink = String(cells[colIndex.link]?.formattedValue || "").trim();
    const cleanLink = hyperLink || extractUrl(formattedLink);

    const bg = cells[colIndex.activity]?.userEnteredFormat?.backgroundColor;
    const isReservation = bg && (
      Math.abs((bg.red || 0) - 0.65) < 0.1 && 
      Math.abs((bg.green || 0) - 0.11) < 0.1 && 
      (bg.blue || 0) < 0.1
    );

    const activity: ItineraryActivity = {
      id: `act-${index}`,
      date: activityDate,
      time: String(cells[colIndex.time]?.formattedValue || "").trim(),
      title: activityTitle,
      location: String(cells[colIndex.location]?.formattedValue || "").trim(),
      link: cleanLink || undefined,
      cost: String(cells[colIndex.cost]?.formattedValue || "").trim() || undefined,
      notes: String(cells[colIndex.notes]?.formattedValue || "").trim(),
      category: inferredCategory.display,
      requiresReservation: !!isReservation,
      type: inferredCategory.type
    };

    if (!daysMap.has(activityDate)) {
      daysMap.set(activityDate, []);
    }
    daysMap.get(activityDate)!.push(activity);
  });

  const parseForSort = (dateStr: string) => {
    let cleanDateStr = dateStr;
    const match = dateStr.match(/\d/);
    if (match) cleanDateStr = dateStr.substring(match.index!);
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(cleanDateStr)) {
      const parts = cleanDateStr.split('T')[0].split(/[-/]/).map(s => parseInt(s, 10));
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const parts = cleanDateStr.split('/');
    if (parts.length >= 3) {
      const m = parseInt(parts[0], 10);
      const d = parseInt(parts[1], 10);
      let y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
      if (d > 12) return new Date(y, m - 1, d);
      if (m > 12) return new Date(y, d - 1, m);
      return new Date(y, m - 1, d);
    }
    let d = new Date(dateStr);
    if (isNaN(d.getTime())) d = new Date(dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1'));
    return d;
  };

  const sortedDates = Array.from(daysMap.keys()).sort((a, b) => {
    return parseForSort(a).getTime() - parseForSort(b).getTime();
  });

  const days: ItineraryDay[] = sortedDates.map((dateStr, index) => ({
    day: index + 1,
    date: dateStr,
    activities: daysMap.get(dateStr) || []
  }));

  return { title: "Waddling Around Japan", days };
}

function inferCategory(title: string, category: string): { display: string, type: ItineraryActivity["type"] } {
  const combined = `${category} ${title}`.toLowerCase();
  if (combined.includes('food') || combined.includes('eat') || combined.includes('drink') || combined.includes('dinner') || combined.includes('lunch') || combined.includes('snack') || combined.includes('ramen') || combined.includes('breakfast') || combined.includes('restaurant')) return { display: category || "Dining", type: "food" };
  if (combined.includes('transport') || combined.includes('travel') || combined.includes('flight') || combined.includes('train') || combined.includes('bus') || combined.includes('shinkansen') || combined.includes('narita') || combined.includes('haneda') || combined.includes('limousine') || combined.includes('airport')) return { display: category || "Transport", type: "transport" };
  if (combined.includes('hotel') || combined.includes('lodging') || combined.includes('stay') || combined.includes('airbnb') || combined.includes('accommodation') || combined.includes('check in') || combined.includes('check-in')) return { display: category || "Stay", type: "accommodation" };
  if (combined.includes('shop') || combined.includes('mall') || combined.includes('store') || combined.includes('market') || combined.includes('don quijote') || combined.includes('pokemon')) return { display: category || "Shopping", type: "shopping" };
  if (combined.includes('sight') || combined.includes('attraction') || combined.includes('shrine') || combined.includes('park') || combined.includes('castle') || combined.includes('museum') || combined.includes('temple') || combined.includes('pagoda') || combined.includes('tower') || combined.includes('garden')) return { display: category || "Sightseeing", type: "sightseeing" };
  return { display: category || "Other", type: "other" };
}

function extractUrl(value: string): string | null {
  if (!value) return null;
  if (value.startsWith('=HYPERLINK')) {
    const match = value.match(/=HYPERLINK\("(.*?)",/i);
    if (match && match[1]) value = match[1];
  }
  value = value.trim();
  if (value.includes('.') && !value.includes(' ')) {
    if (!value.startsWith('http')) return `https://${value}`;
    return value;
  }
  return null;
}
