import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchItinerary, type Itinerary } from '../services/sheets';

export function useItinerary(timeOffset: number = 0) {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const getInitialTime = useCallback(() => new Date(Date.now() + timeOffset), [timeOffset]);
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
      setItinerary(data);
      setLastUpdated(new Date());
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
