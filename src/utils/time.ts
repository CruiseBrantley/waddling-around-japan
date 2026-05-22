/**
 * Converts a time string like "9:30 AM" or "14:30" to minutes from midnight
 */
export const timeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  
  // Handle formats like "9:30 AM", "14:30", "7 PM", "19"
  const match = timeStr.match(/(\d+)(?::(\d+))?\s*(AM|PM)?/i);
  if (!match) return 0;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const modifier = match[3]?.toUpperCase();

  if (modifier === 'PM' && hours < 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;

  return hours * 60 + minutes;
};

/**
 * Parses standard time string (e.g. "09:00", "2:30 PM", "18:00") and returns its hour integer (0-23)
 */
export function parseTimeToHour(timeStr: string): number | null {
  if (!timeStr) return null;
  const cleaned = timeStr.trim().toLowerCase();
  
  // Format check for HH:MM (possibly with AM/PM)
  const regex = /(\d+):(\d+)\s*(am|pm)?/;
  const match = cleaned.match(regex);
  if (match) {
    let hour = parseInt(match[1], 10);
    const isPm = match[3] === 'pm';
    const isAm = match[3] === 'am';
    
    if (isPm && hour < 12) {
      hour += 12;
    } else if (isAm && hour === 12) {
      hour = 0;
    }
    
    if (hour >= 0 && hour <= 23) {
      return hour;
    }
  }
  
  // Alternative match for just single numbers like "2 PM" or "14"
  const simpleRegex = /(\d+)\s*(am|pm)/;
  const simpleMatch = cleaned.match(simpleRegex);
  if (simpleMatch) {
    let hour = parseInt(simpleMatch[1], 10);
    const isPm = simpleMatch[2] === 'pm';
    if (isPm && hour < 12) {
      hour += 12;
    } else if (simpleMatch[2] === 'am' && hour === 12) {
      hour = 0;
    }
    if (hour >= 0 && hour <= 23) {
      return hour;
    }
  }
  
  return null;
}
