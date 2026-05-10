import { fetchItinerary, ItineraryDay } from './sheets';
import webPush from 'web-push';
import fs from 'fs';
import path from 'path';

// Helper to convert "HH:MM" to minutes from midnight
export const timeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d+):(\d+)/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return (hours * 60) + minutes;
};

// Helper to check if a date string matches a Date object
export const isSameDay = (dateStr: string, dateObj: Date) => {
  // Use local timezone formatting to avoid UTC offset shifts
  const localDateStr = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000))
    .toISOString()
    .split('T')[0];
  
  // Also handle cases where dateStr might have slashes or trailing data
  const cleanDateStr = dateStr.replace(/\//g, '-').split('T')[0];
  
  return localDateStr === cleanDateStr;
};

export interface AlertTarget {
  title: string;
  minutes: number;
}

// Memory of what we've already notified to avoid spam
const notifiedEvents = new Set<string>();

export const getNextEvent = (days: ItineraryDay[], currentTime: Date): AlertTarget | null => {
  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes() + (currentTime.getSeconds() / 60);
  const todayIdx = days.findIndex(d => isSameDay(d.date, currentTime));
  if (todayIdx === -1) return null;

  const today = days[todayIdx];
  
  // Find NEXT event today
  const upcomingToday = today.activities
    .map(act => ({ ...act, minutes: timeToMinutes(act.time) - nowMin }))
    .filter(act => act.minutes > 0)
    .sort((a, b) => a.minutes - b.minutes);

  if (upcomingToday.length > 0) {
    return { title: upcomingToday[0].title, minutes: upcomingToday[0].minutes };
  } else {
    // Check next day
    for (let i = todayIdx + 1; i < days.length; i++) {
      const nextDay = days[i];
      if (nextDay.activities.length > 0) {
        const firstActivity = nextDay.activities[0];
        const daysBetween = i - todayIdx;
        const minutesUntil = (daysBetween * 24 * 60) - nowMin + timeToMinutes(firstActivity.time);
        return { title: firstActivity.title, minutes: minutesUntil };
      }
    }
  }
  return null;
};

export const getJapanTime = (): Date => {
  const japanTimeStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" });
  return new Date(japanTimeStr);
};

// Main polling function called by the cron job
export const pollAndNotify = async () => {
  try {
    const itinerary = await fetchItinerary();
    if (!itinerary || !itinerary.days || itinerary.days.length === 0) return;

    // Use Japan time since the itinerary is based in Japan, 
    // but the server is running in CST.
    const currentTime = getJapanTime();
    const nextEvent = getNextEvent(itinerary.days, currentTime);

    if (!nextEvent) return;

    const { title, minutes } = nextEvent;

    // Hardcoded thresholds for server alerts (could be configurable in the future)
    const isUrgent = minutes > 0 && minutes <= 5; // 5 minutes before
    const isHeadsUp = minutes > 5 && minutes <= 15; // 15 minutes before

    let alertType: 'info' | 'urgent' | null = null;
    let message = '';
    let eventId = '';

    if (isUrgent) {
      eventId = `urgent-${title}`;
      alertType = 'urgent';
      message = `Time to head to ${title}!`;
    } else if (isHeadsUp) {
      eventId = `headsup-${title}`;
      alertType = 'info';
      message = `Starting in ${Math.ceil(minutes)} minutes!`;
    }

    if (alertType && !notifiedEvents.has(eventId)) {
      await broadcastNotification({
        title: alertType === 'urgent' ? `Starting Now: ${title}` : `Upcoming: ${title}`,
        body: message,
        type: alertType,
        tag: 'itinerary-alert' // Matches the frontend tag so it replaces old ones
      });
      notifiedEvents.add(eventId);
    }

  } catch (error) {
    console.error('Polling error:', error);
  }
};

const broadcastNotification = async (payloadObj: Record<string, unknown>) => {
  const SUBSCRIPTIONS_FILE = path.join(__dirname, '..', 'subscriptions.json');
  if (!fs.existsSync(SUBSCRIPTIONS_FILE)) return;

  try {
    const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
    const subscriptions = JSON.parse(data);
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify(payloadObj);

    console.log(`Broadcasting Web Push: ${String(payloadObj.title)}`);
    await Promise.allSettled(
      subscriptions.map((sub: webPush.PushSubscription) => webPush.sendNotification(sub, payload))
    );
  } catch (e) {
    console.error('Broadcast failed:', e);
  }
};
