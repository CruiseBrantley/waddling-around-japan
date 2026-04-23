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
  type:
    | "sightseeing"
    | "food"
    | "transport"
    | "accommodation"
    | "shopping"
    | "other";
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

interface SheetsV4Response {
  values: string[][];
}

const API_KEY = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY;
const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID;
const RANGE = import.meta.env.VITE_GOOGLE_SHEET_NAME || 'Itinerary';

const CACHE_KEY = 'itinerary_cache';

/**
 * Fetch itinerary data from Google Sheets V4 API
 */
export async function fetchItinerary(): Promise<Itinerary> {
  if (!API_KEY || !SPREADSHEET_ID) {
    throw new Error("Google Sheets API Key or Spreadsheet ID is missing in .env");
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(RANGE)}?key=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Sheets API Error: ${response.statusText}`);
    }

    const data: SheetsV4Response = await response.json();
    const itinerary = transformV4Data(data.values);
    
    // Save to local storage for offline use
    localStorage.setItem(CACHE_KEY, JSON.stringify(itinerary));
    
    return itinerary;
  } catch (error) {
    console.warn("App: Fetch failed, checking local cache...", error);
    
    const cachedData = localStorage.getItem(CACHE_KEY);
    if (cachedData) {
      console.log("App: Using cached itinerary data from LocalStorage.");
      return JSON.parse(cachedData);
    }
    
    throw error;
  }
}

/**
 * Transform V4 API response (2D array) into structured itinerary
 */
function transformV4Data(values: string[][]): Itinerary {
  if (!values || values.length < 5) {
    return { title: "Waddling Around Japan", days: [] };
  }

  // Based on inspection, headers are on row 3 (index 2)
  // Data starts on row 5 (index 4)
  const headerRow = values[2] || [];
  const startRowIndex = 4;
  
  // Find column indices
  const colIndex = {
    date: headerRow.findIndex(h => h?.trim().toLowerCase() === 'date'),
    time: headerRow.findIndex(h => h?.trim().toLowerCase() === 'time'),
    activity: headerRow.findIndex(h => h?.trim().toLowerCase() === 'activity'),
    location: headerRow.findIndex(h => h?.trim().toLowerCase() === 'location'),
    link: headerRow.findIndex(h => h?.trim().toLowerCase() === 'link'),
    cost: headerRow.findIndex(h => h?.trim().toLowerCase() === 'cost'),
    notes: headerRow.findIndex(h => h?.trim().toLowerCase() === 'notes'),
    category: headerRow.findIndex(h => {
      const lower = h?.trim().toLowerCase();
      return lower === 'category' || lower === 'type' || lower === 'tag';
    }),
  };

  const daysMap = new Map<string, ItineraryActivity[]>();
  let lastValidDate = "";

  values.slice(startRowIndex).forEach((row, index) => {
    // If row is too short to have the activity field, skip
    if (row.length <= Math.max(colIndex.activity, colIndex.date)) return;

    const activityTitle = row[colIndex.activity]?.trim();
    if (!activityTitle) return; // Skip rows without activity

    let activityDate = row[colIndex.date]?.trim();
    
    // Fill in date if it's a sub-activity of the same day
    if (!activityDate && lastValidDate) {
      activityDate = lastValidDate;
    } else if (activityDate) {
      lastValidDate = activityDate;
    }

    if (!activityDate) return;

    const activity: ItineraryActivity = {
      id: `act-${index}`,
      date: activityDate,
      time: row[colIndex.time]?.trim() || "",
      title: activityTitle,
      location: row[colIndex.location]?.trim() || "",
      link: row[colIndex.link]?.trim() || undefined,
      cost: row[colIndex.cost]?.trim() || undefined,
      notes: row[colIndex.notes]?.trim() || "",
      category: row[colIndex.category]?.trim() || "Other",
      type: normalizeCategoryToType(row[colIndex.category]?.trim() || "")
    };

    if (!daysMap.has(activityDate)) {
      daysMap.set(activityDate, []);
    }
    daysMap.get(activityDate)!.push(activity);
  });

  const sortedDates = Array.from(daysMap.keys()).sort((a, b) => {
    return new Date(a).getTime() - new Date(b).getTime();
  });

  const days: ItineraryDay[] = sortedDates.map((dateStr, index) => ({
    day: index + 1,
    date: dateStr,
    activities: daysMap.get(dateStr) || []
  }));

  return {
    title: "Waddling Around Japan",
    days
  };
}

function normalizeCategoryToType(category: string): ItineraryActivity["type"] {
  const lower = category.toLowerCase();
  if (lower.includes('food') || lower.includes('eat') || lower.includes('drink') || lower.includes('dinner') || lower.includes('lunch') || lower.includes('snack') || lower.includes('ramen')) return 'food';
  if (lower.includes('transport') || lower.includes('travel') || lower.includes('flight') || lower.includes('train') || lower.includes('bus') || lower.includes('shinkansen') || lower.includes('walk')) return 'transport';
  if (lower.includes('hotel') || lower.includes('lodging') || lower.includes('stay') || lower.includes('airbnb') || lower.includes('accommodation')) return 'accommodation';
  if (lower.includes('shop') || lower.includes('mall') || lower.includes('store') || lower.includes('market')) return 'shopping';
  if (lower.includes('sight') || lower.includes('attraction') || lower.includes('shrine') || lower.includes('park') || lower.includes('castle') || lower.includes('museum') || lower.includes('temple')) return 'sightseeing';
  return 'other';
}




