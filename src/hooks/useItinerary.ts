import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchItinerary, fetchBulkRegions, type Itinerary } from '../services/sheets';

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

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function addImplicitRegions(regions: string[], activities: any[]): string[] {
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
          break;
        }
      }
    }
  }

  return updatedRegions;
}


export function useItinerary(debugOffset: number | null = null) {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const getInitialTime = useCallback(() => {
    // 1. Manual Debug Overrides (Reactive from Settings)
    // Priority: Settings Offset > URL Param > System Time
    if (debugOffset !== null) {
      return new Date(Date.now() + debugOffset);
    }

    // 2. URL Parameter Mocking (Legacy/CI Testing)
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const mockDateStr = params.get('date');
    if (mockDateStr) {
      const mockDate = new Date(mockDateStr);
      if (!isNaN(mockDate.getTime())) {
        const offset = mockDate.getTime() - Date.now();
        return new Date(Date.now() + offset);
      }
    }

    // 3. System Time
    return new Date();
  }, [debugOffset]);
  
  const [currentTime, setCurrentTime] = useState(() => getInitialTime());

  // Helper to parse dates robustly and timezone-agnostically from sheet strings
  const parseSheetDate = useCallback((dateStr: string) => {
    let cleanDateStr = dateStr;
    const match = dateStr.match(/\d/);
    if (match) {
      cleanDateStr = dateStr.substring(match.index!);
    }

    // Handle YYYY-MM-DD or YYYY/MM/DD
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(cleanDateStr)) {
      const parts = cleanDateStr.split('T')[0].split(/[-/]/).map(s => parseInt(s, 10));
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    
    // Handle MM/DD/YYYY, M/D/YY, DD/MM/YYYY, etc.
    const parts = cleanDateStr.split('/');
    if (parts.length >= 3) {
      const m = parseInt(parts[0], 10);
      const d = parseInt(parts[1], 10);
      const y_raw = parseInt(parts[2], 10);
      const y = y_raw < 100 ? y_raw + 2000 : y_raw;
      
      // If middle part is > 12, it must be American MM/DD/YYYY
      if (d > 12) {
        return new Date(y, m - 1, d);
      } else {
        // If first part > 12, it must be DD/MM/YYYY
        if (m > 12) {
          return new Date(y, d - 1, m);
        }
        // Otherwise assume American MM/DD/YYYY by default
        return new Date(y, m - 1, d);
      }
    }

    // Fallback to standard parsing
    let d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      d = new Date(dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1'));
    }
    return isNaN(d.getTime()) ? new Date(NaN) : d;
  }, []);

  // Load Data
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await fetchItinerary();
      // Instantly enrich regions with implicit ones for immediate/offline correctness
      data.days.forEach(day => {
        day.regions = addImplicitRegions(day.regions || ['Tokyo'], day.activities);
      });
      setItinerary(data);
      setLastUpdated(new Date());

      // Trigger background region extraction non-blockingly
      fetchBulkRegions().then(regionsMap => {
        if (Object.keys(regionsMap).length > 0) {
          setItinerary(prev => {
            if (!prev) return prev;
            const updated = { ...prev, days: [...prev.days] };
            updated.days.forEach((day, index) => {
              const serverRegions = regionsMap[day.date] || ['Tokyo'];
              updated.days[index] = { 
                ...day, 
                regions: addImplicitRegions(serverRegions, day.activities) 
              };
            });
            return updated;
          });
        }
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load itinerary');
    } finally {
      setLoading(false);
      if (isRefresh) {
        setTimeout(() => setRefreshing(false), 1000);
      }
    }
  }, []);

  // Initial Load & Focus Sync
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
    
    const handleFocus = () => loadData(true);
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadData]);

  // Live Time Update
  useEffect(() => {
    const updateTime = () => {
      const newTime = getInitialTime();
      setCurrentTime(newTime);
    };
    updateTime(); // Call immediately on change
    const intervalId = setInterval(updateTime, 1000); // Update every second for smooth countdowns
    return () => clearInterval(intervalId);
  }, [getInitialTime]);

  // Derived State
  const isTripActive = useMemo(() => {
    if (!itinerary || itinerary.days.length === 0) return false;
    
    const start = parseSheetDate(itinerary.days[0].date);
    if (isNaN(start.getTime())) return false;
    start.setHours(0, 0, 0, 0);

    const end = parseSheetDate(itinerary.days[itinerary.days.length - 1].date);
    if (isNaN(end.getTime())) return false;
    end.setHours(23, 59, 59, 999);

    return currentTime >= start && currentTime <= end;
  }, [itinerary, currentTime, parseSheetDate]);

  return {
    itinerary,
    loading,
    error,
    refreshing,
    lastUpdated,
    currentTime,
    loadData,
    isTripActive,
    getInitialTime
  };
}
