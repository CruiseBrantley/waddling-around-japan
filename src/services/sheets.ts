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

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(RANGE)}?key=${API_KEY}&valueRenderOption=FORMULA`;

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
  console.log("Headers found:", headerRow);
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

    // Use category column if available, otherwise infer from title
    const rawCategory = row[colIndex.category]?.trim() || "";
    const inferredCategory = inferCategory(activityTitle, rawCategory);

    const rawLink = row[colIndex.link]?.trim() || "";
    const cleanLink = extractUrl(rawLink);

    const activity: ItineraryActivity = {
      id: `act-${index}`,
      date: activityDate,
      time: row[colIndex.time]?.trim() || "",
      title: activityTitle,
      location: row[colIndex.location]?.trim() || "",
      link: cleanLink || undefined,
      cost: row[colIndex.cost]?.trim() || undefined,
      notes: row[colIndex.notes]?.trim() || "",
      category: inferredCategory.display,
      type: inferredCategory.type
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

/**
 * Intelligent category inference based on title and explicit category
 */
function inferCategory(title: string, category: string): { display: string, type: ItineraryActivity["type"] } {
  const combined = `${category} ${title}`.toLowerCase();
  
  if (combined.includes('food') || combined.includes('eat') || combined.includes('drink') || combined.includes('dinner') || combined.includes('lunch') || combined.includes('snack') || combined.includes('ramen') || combined.includes('breakfast') || combined.includes('restaurant')) {
    return { display: category || "Dining", type: "food" };
  }
  if (combined.includes('transport') || combined.includes('travel') || combined.includes('flight') || combined.includes('train') || combined.includes('bus') || combined.includes('shinkansen') || combined.includes('narita') || combined.includes('haneda') || combined.includes('limousine') || combined.includes('airport')) {
    return { display: category || "Transport", type: "transport" };
  }
  if (combined.includes('hotel') || combined.includes('lodging') || combined.includes('stay') || combined.includes('airbnb') || combined.includes('accommodation') || combined.includes('check in') || combined.includes('check-in')) {
    return { display: category || "Stay", type: "accommodation" };
  }
  if (combined.includes('shop') || combined.includes('mall') || combined.includes('store') || combined.includes('market') || combined.includes('don quijote') || combined.includes('pokemon')) {
    return { display: category || "Shopping", type: "shopping" };
  }
  if (combined.includes('sight') || combined.includes('attraction') || combined.includes('shrine') || combined.includes('park') || combined.includes('castle') || combined.includes('museum') || combined.includes('temple') || combined.includes('pagoda') || combined.includes('tower') || combined.includes('garden')) {
    return { display: category || "Sightseeing", type: "sightseeing" };
  }
  
  return { display: category || "Other", type: "other" };
}

/**
 * Extracts a URL from a Google Sheets cell value. 
 * Handles plain URLs and "=HYPERLINK("url", "label")" formulas.
 */
function extractUrl(value: string): string | null {
  if (!value) return null;

  // Handle Google Sheets HYPERLINK formula
  if (value.startsWith('=HYPERLINK')) {
    const match = value.match(/=HYPERLINK\("(.*?)",/i);
    if (match && match[1]) {
      value = match[1];
    }
  }

  // Remove whitespace
  value = value.trim();

  // If it's a valid URL, ensure it has a protocol
  if (value.includes('.') && !value.includes(' ')) {
    if (!value.startsWith('http')) {
      return `https://${value}`;
    }
    return value;
  }

  return null;
}




