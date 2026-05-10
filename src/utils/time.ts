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
