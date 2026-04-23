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
 * Transform Full Spreadsheet API response into structured itinerary
 */
function transformFullSheetData(rowData: any[]): Itinerary {
  if (!rowData || rowData.length < 5) {
    return { title: "Waddling Around Japan", days: [] };
  }

  // Header row is index 2
  const headerCells = rowData[2]?.values || [];
  const headerRow = headerCells.map((c: any) => String(c?.formattedValue || "").trim());
  const startRowIndex = 4;
  
  const colIndex = {
    date: headerRow.findIndex(h => h.toLowerCase() === 'date'),
    time: headerRow.findIndex(h => h.toLowerCase() === 'time'),
    activity: headerRow.findIndex(h => h.toLowerCase() === 'activity'),
    location: headerRow.findIndex(h => h.toLowerCase() === 'location'),
    link: headerRow.findIndex(h => h.toLowerCase() === 'link' || h.toLowerCase() === 'type' || h.toLowerCase() === 'url'), // Flexible link name
    cost: headerRow.findIndex(h => h.toLowerCase() === 'cost'),
    notes: headerRow.findIndex(h => h.toLowerCase() === 'notes'),
    category: headerRow.findIndex(h => {
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

    // Use category column if available, otherwise infer from title
    const rawCategory = String(cells[colIndex.category]?.formattedValue || "").trim();
    const inferredCategory = inferCategory(activityTitle, rawCategory);

    // Get Link: prioritized raw hyperlink property, then formatted formula text
    const hyperLink = cells[colIndex.link]?.hyperlink;
    const formattedLink = String(cells[colIndex.link]?.formattedValue || "").trim();
    const cleanLink = hyperLink || extractUrl(formattedLink);

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




