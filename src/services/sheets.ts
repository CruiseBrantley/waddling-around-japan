export interface ItineraryActivity {
  id: string;
  date: string;
  time: string;
  title: string;
  titleHtml?: string;
  fullTitle: string;
  smartChip?: string;
  location: string;
  locationLink?: string;
  link?: string;
  cost?: string;
  notes: string;
  category: string;
  categoryBackgroundColor?: string;
  categoryForegroundColor?: string;
  requiresReservation?: boolean;
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

const API_KEY = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY;
const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID;
const RANGE = import.meta.env.VITE_GOOGLE_SHEET_NAME || 'Itinerary';

const CACHE_KEY = 'itinerary_cache';

interface SheetRow {
  values?: Array<{
    formattedValue?: string;
    hyperlink?: string;
    effectiveFormat?: {
      backgroundColor?: {
        red?: number;
        green?: number;
        blue?: number;
      };
      textFormat?: {
        foregroundColor?: {
          red?: number;
          green?: number;
          blue?: number;
        };
        bold?: boolean;
        italic?: boolean;
      };
    };
    userEnteredFormat?: {
      backgroundColor?: {
        red?: number;
        green?: number;
        blue?: number;
      };
    };
    textFormatRuns?: Array<{
      startIndex?: number;
      format?: {
        foregroundColor?: {
          red?: number;
          green?: number;
          blue?: number;
        };
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
        strikethrough?: boolean;
        link?: {
          uri?: string;
        };
      };
    }>;
    chipRuns?: Array<{
      startIndex?: number;
      chip?: {
        richLinkProperties?: {
          uri?: string;
        };
      };
    }>;
  }>;
}

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

type RGBColor = { red?: number; green?: number; blue?: number };

/**
 * Helper to ignore pure white and alternating light gray row colors
 */
function isSignificantColor(bg: RGBColor | null | undefined): boolean {
  if (!bg) return false;
  const r = bg.red ?? 0;
  const g = bg.green ?? 0;
  const b = bg.blue ?? 0;
  // Ignore pure white
  if (r === 1 && g === 1 && b === 1) return false;
  // Ignore very light grays (e.g., alternating row colors like 0.95, 0.95, 0.95)
  if (r > 0.92 && g > 0.92 && b > 0.92 && Math.abs(r - g) < 0.05 && Math.abs(g - b) < 0.05) return false;
  return true;
}

/**
 * Transform Full Spreadsheet API response into structured itinerary
 */
function transformFullSheetData(rowData: SheetRow[]): Itinerary {
  if (!rowData || rowData.length < 2) {
    return { title: "Waddling Around Japan", days: [] };
  }

  // 1. Dynamic Header Detection: Scan first 10 rows for keywords
  let headerRowIndex = -1;
  let headerRow: string[] = [];
  
  for (let i = 0; i < Math.min(rowData.length, 10); i++) {
    const cells = rowData[i]?.values || [];
    const row = cells.map(c => String(c?.formattedValue || "").trim().toLowerCase());
    if (row.includes('activity') || (row.includes('date') && row.includes('time'))) {
      headerRowIndex = i;
      headerRow = row;
      break;
    }
  }

  // Fallback to row 2 if not found (legacy behavior)
  if (headerRowIndex === -1) {
    headerRowIndex = 2;
    const headerCells = rowData[2]?.values || [];
    headerRow = headerCells.map(c => String(c?.formattedValue || "").trim().toLowerCase());
  }

  const startRowIndex = headerRowIndex + 1;
  
  const colIndex = {
    date: headerRow.findIndex(h => h === 'date'),
    time: headerRow.findIndex(h => h === 'time'),
    activity: headerRow.findIndex(h => h === 'activity' || h === 'event' || h === 'description' || h === 'name'),
    location: headerRow.findIndex(h => h === 'location' || h === 'place' || h === 'address'),
    link: headerRow.findIndex(h => h === 'link' || h === 'url' || h === 'website'),
    cost: headerRow.findIndex(h => h === 'cost' || h === 'price'),
    notes: headerRow.findIndex(h => h === 'notes' || h === 'comments' || h === 'info'),
    category: headerRow.findIndex(h => h === 'category' || h === 'type' || h === 'tag' || h === 'label'),
  };

  const daysMap = new Map<string, ItineraryActivity[]>();
  let lastValidDate = "";

  rowData.slice(startRowIndex).forEach((rowObj, index) => {
    const cells = rowObj.values || [];
    if (cells.length === 0) return;

    // Must have at least one significant column
    const activityCell = colIndex.activity !== -1 ? cells[colIndex.activity] : null;
    let activityTitle = activityCell ? String(activityCell.formattedValue || "").trim() : "";
    let smartChip: string | undefined = undefined;

    const fullTitle = activityTitle;
    // Isolate Smart Chips using formatting runs!
    if (activityCell?.chipRuns && activityCell.chipRuns.length > 0) {
      const linkRun = activityCell.chipRuns.find(run => run.chip?.richLinkProperties?.uri);
      if (linkRun) {
        const startIndex = linkRun.startIndex || 0;
        smartChip = activityTitle.substring(startIndex).trim();
        activityTitle = activityTitle.substring(0, startIndex).trim();
      }
    } else if (activityCell?.textFormatRuns && activityCell.textFormatRuns.length > 1) {
      const linkRun = activityCell.textFormatRuns.find(run => run.format?.link?.uri);
      if (linkRun) {
        const startIndex = linkRun.startIndex || 0;
        smartChip = activityTitle.substring(startIndex).trim();
        activityTitle = activityTitle.substring(0, startIndex).trim();
      }
    }

    const rawCategory = colIndex.category !== -1 ? (cells[colIndex.category]?.formattedValue || "").trim() : "";
    
    if (!activityTitle && !rawCategory) return;

    let activityDate = colIndex.date !== -1 ? String(cells[colIndex.date]?.formattedValue || "").trim() : "";
    
    if (!activityDate && lastValidDate) {
      activityDate = lastValidDate;
    } else if (activityDate) {
      lastValidDate = activityDate;
    }

    if (!activityDate) return;

    // COLOR EXTRACTION LOGIC
    let finalBg: RGBColor | null | undefined = null;
    let finalFg: RGBColor | null | undefined = null;

    // 1. Try Category cell first
    const catFormat = colIndex.category !== -1 ? cells[colIndex.category]?.effectiveFormat : null;
    const catBg = catFormat?.backgroundColor;
    if (isSignificantColor(catBg)) {
      finalBg = catBg;
      finalFg = catFormat?.textFormat?.foregroundColor;
    }

    // 2. Try Activity cell second
    if (!finalBg) {
      const actFormat = colIndex.activity !== -1 ? cells[colIndex.activity]?.effectiveFormat : null;
      const actBg = actFormat?.backgroundColor;
      if (isSignificantColor(actBg)) {
        finalBg = actBg;
        finalFg = actFormat?.textFormat?.foregroundColor;
      }
    }

    // 3. ROW-WIDE FALLBACK: Scan all cells in the row for ANY non-white color
    if (!finalBg) {
      for (const cell of cells) {
        const bg = cell?.effectiveFormat?.backgroundColor;
        if (isSignificantColor(bg)) {
          finalBg = bg;
          finalFg = cell?.effectiveFormat?.textFormat?.foregroundColor;
          break;
        }
      }
    }

    const categoryBackgroundColor = finalBg ? `rgb(${Math.round((finalBg.red || 0) * 255)}, ${Math.round((finalBg.green || 0) * 255)}, ${Math.round((finalBg.blue || 0) * 255)})` : undefined;
    const categoryForegroundColor = finalFg ? `rgb(${Math.round((finalFg.red || 0) * 255)}, ${Math.round((finalFg.green || 0) * 255)}, ${Math.round((finalFg.blue || 0) * 255)})` : undefined;

    const inferredCategory = inferCategory(activityTitle, rawCategory);

    // Get Link: prioritized raw hyperlink property, then formatted formula text
    const cellWithLink = colIndex.link !== -1 ? cells[colIndex.link] : null;
    const hyperLink = cellWithLink?.hyperlink;
    const formattedLink = String(cellWithLink?.formattedValue || "").trim();
    const cleanLink = hyperLink || extractUrl(formattedLink);

    // Target specific reservation color (Maroon/Dark Red: ~0.65, 0.11, 0.0)
    // Always check activity cell or any cell in row
    const isReservation = finalBg && (
      Math.abs((finalBg.red || 0) - 0.65) < 0.1 && 
      Math.abs((finalBg.green || 0) - 0.11) < 0.1 && 
      (finalBg.blue || 0) < 0.1
    );

    // Extract Location & its precise link if available (hyperlink or Maps chip)
    const locationCell = colIndex.location !== -1 ? cells[colIndex.location] : null;
    const locationValue = String(locationCell?.formattedValue || "").trim();
    let locationLink = locationCell?.hyperlink || extractUrl(locationValue) || undefined;
    
    if (!locationLink && locationCell?.chipRuns && locationCell.chipRuns.length > 0) {
      locationLink = locationCell.chipRuns.find(run => run.chip?.richLinkProperties?.uri)?.chip?.richLinkProperties?.uri || locationLink;
    }

    const titleHtml = activityCell ? renderRichTextToHtml(
      activityCell.formattedValue || "",
      activityCell.textFormatRuns,
      activityCell.effectiveFormat,
      activityTitle.length
    ) : "";

    const activity: ItineraryActivity = {
      id: `act-${index}`,
      date: activityDate,
      time: colIndex.time !== -1 ? String(cells[colIndex.time]?.formattedValue || "").trim() : "",
      title: activityTitle,
      titleHtml: titleHtml || undefined,
      fullTitle: fullTitle,
      smartChip: smartChip,
      location: locationValue,
      locationLink: locationLink,
      link: cleanLink || undefined,
      cost: colIndex.cost !== -1 ? String(cells[colIndex.cost]?.formattedValue || "").trim() || undefined : undefined,
      notes: colIndex.notes !== -1 ? String(cells[colIndex.notes]?.formattedValue || "").trim() : "",
      category: rawCategory,
      categoryBackgroundColor,
      categoryForegroundColor,
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
  
  // 1. Determine visual 'type' for styling (always inferred)
  // Re-ordered to prioritize transport/travel as they often overlap with destinations
  let type: ItineraryActivity["type"] = "other";
  if (combined.includes('transport') || combined.includes('travel') || combined.includes('flight') || combined.includes('train') || combined.includes('bus') || combined.includes('shinkansen') || combined.includes('narita') || combined.includes('haneda') || combined.includes('limousine') || combined.includes('airport') || combined.includes('head to') || combined.includes('walk to')) {
    type = "transport";
  } else if (combined.includes('food') || combined.includes('eat') || combined.includes('drink') || combined.includes('dinner') || combined.includes('lunch') || combined.includes('snack') || combined.includes('ramen') || combined.includes('breakfast') || combined.includes('restaurant')) {
    type = "food";
  } else if (combined.includes('hotel') || combined.includes('lodging') || combined.includes('stay') || combined.includes('airbnb') || combined.includes('accommodation') || combined.includes('check in') || combined.includes('check-in')) {
    type = "accommodation";
  } else if (combined.includes('shop') || combined.includes('mall') || combined.includes('store') || combined.includes('market') || combined.includes('don quijote') || combined.includes('pokemon')) {
    type = "shopping";
  } else if (combined.includes('sight') || combined.includes('attraction') || combined.includes('shrine') || combined.includes('park') || combined.includes('castle') || combined.includes('museum') || combined.includes('temple') || combined.includes('pagoda') || combined.includes('tower') || combined.includes('garden')) {
    type = "sightseeing";
  }

  // 2. Determine display text: Prioritize explicit category, then fallback to inferred default
  let display = category;
  if (!display) {
    if (type === "food") display = "Dining";
    else if (type === "transport") display = "Transport";
    else if (type === "accommodation") display = "Stay";
    else if (type === "shopping") display = "Shopping";
    else if (type === "sightseeing") display = "Sightseeing";
    else display = "Other";
  }
  
  return { display, type };
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

/**
 * Convert RGB color from Sheets API (0-1 float) to CSS rgb/rgba format.
 */
function rgbToCssColor(rgb: { red?: number; green?: number; blue?: number } | null | undefined): string | null {
  if (!rgb) return null;
  const r = Math.round((rgb.red ?? 0) * 255);
  const g = Math.round((rgb.green ?? 0) * 255);
  const b = Math.round((rgb.blue ?? 0) * 255);
  
  // If the color is flat black, ignore it so it inherits high-contrast white text color!
  if (r === 0 && g === 0 && b === 0) return null;
  
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Escapes special characters to prevent HTML injection while preserving structural tags.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Processes cell formatting runs and generates rich HTML to preserve exact Google Sheets cell typography and colors.
 */
function renderRichTextToHtml(
  text: string,
  runs: Array<{
    startIndex?: number;
    format?: {
      foregroundColor?: { red?: number; green?: number; blue?: number };
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strikethrough?: boolean;
    };
  }> | undefined,
  defaultFormat?: {
    textFormat?: {
      foregroundColor?: { red?: number; green?: number; blue?: number };
      bold?: boolean;
      italic?: boolean;
    };
  },
  maxLength?: number
): string {
  const fullText = maxLength !== undefined ? text.substring(0, maxLength) : text;
  if (!fullText) return "";

  // 1. Fallback if no runs: use cell-wide formatting
  if (!runs || runs.length === 0) {
    const fg = defaultFormat?.textFormat?.foregroundColor;
    const isBold = defaultFormat?.textFormat?.bold;
    const isItalic = defaultFormat?.textFormat?.italic;
    const cssColor = rgbToCssColor(fg);

    if (cssColor || isBold || isItalic) {
      const styles: string[] = [];
      if (cssColor) styles.push(`color: ${cssColor}`);
      if (isBold) styles.push(`font-weight: bold`);
      if (isItalic) styles.push(`font-style: italic`);
      return `<span style="${styles.join('; ')}">${escapeHtml(fullText)}</span>`;
    }
    return escapeHtml(fullText);
  }

  // 2. Filter and sort runs within bounds
  const validRuns = runs
    .map(r => ({
      startIndex: r.startIndex ?? 0,
      format: r.format
    }))
    .filter(r => r.startIndex < fullText.length)
    .sort((a, b) => a.startIndex - b.startIndex);

  if (validRuns.length === 0 || validRuns[0].startIndex > 0) {
    validRuns.unshift({
      startIndex: 0,
      format: defaultFormat?.textFormat
    });
  }

  let html = "";
  for (let i = 0; i < validRuns.length; i++) {
    const currentRun = validRuns[i];
    const start = currentRun.startIndex;
    const end = (i + 1 < validRuns.length) ? validRuns[i + 1].startIndex : fullText.length;

    const slice = fullText.substring(start, end);
    if (!slice) continue;

    const styles: string[] = [];
    const fg = currentRun.format?.foregroundColor || defaultFormat?.textFormat?.foregroundColor;
    const cssColor = rgbToCssColor(fg);
    if (cssColor) styles.push(`color: ${cssColor}`);

    const isBold = currentRun.format?.bold !== undefined ? currentRun.format.bold : defaultFormat?.textFormat?.bold;
    if (isBold) styles.push(`font-weight: bold`);

    const isItalic = currentRun.format?.italic !== undefined ? currentRun.format.italic : defaultFormat?.textFormat?.italic;
    if (isItalic) styles.push(`font-style: italic`);

    const isUnderline = currentRun.format?.underline;
    const isStrikethrough = currentRun.format?.strikethrough;
    const textDeco: string[] = [];
    if (isUnderline) textDeco.push("underline");
    if (isStrikethrough) textDeco.push("line-through");
    if (textDeco.length > 0) {
      styles.push(`text-decoration: ${textDeco.join(" ")}`);
    }

    if (styles.length > 0) {
      html += `<span style="${styles.join('; ')}">${escapeHtml(slice)}</span>`;
    } else {
      html += escapeHtml(slice);
    }
  }

  return html;
}




