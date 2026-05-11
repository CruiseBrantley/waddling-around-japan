import { fetchItinerary, ItineraryDay } from './sheets';
import webPush from 'web-push';
import fs from 'fs';
import path from 'path';
import { SubscriptionData } from './app';

// Helper to convert "HH:MM" to minutes from midnight
export const timeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d+):(\d+)/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return (hours * 60) + minutes;
};

// Helper to check if a date string matches a Date object (in Japan timezone)
export const isSameDay = (dateStr: string, dateObj: Date) => {
  // Use en-CA locale as it gives YYYY-MM-DD
  const japanDateStr = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'Asia/Tokyo' 
  }).format(dateObj);
  
  const cleanDateStr = dateStr.replace(/\//g, '-').split('T')[0];
  return japanDateStr === cleanDateStr;
};

export interface AlertTarget {
  title: string;
  minutes: number;
  time: string;
  category: string;
}

// Helper to get minutes from midnight in Japan time
export const getJapanMinutes = (date: Date): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  }).formatToParts(date);
  
  const h = parseInt(parts.find(p => p.type === 'hour')!.value, 10);
  const m = parseInt(parts.find(p => p.type === 'minute')!.value, 10);
  const s = parseInt(parts.find(p => p.type === 'second')!.value, 10);
  
  return h * 60 + m + (s / 60);
};

export const getNextEvent = (days: ItineraryDay[], currentTime: Date): AlertTarget | null => {
  const nowMin = getJapanMinutes(currentTime);
  const todayIdx = days.findIndex(d => isSameDay(d.date, currentTime));
  if (todayIdx === -1) return null;

  const today = days[todayIdx];
  
  const upcomingToday = today.activities
    .filter(act => act.category.toLowerCase() === 'event')
    .map(act => ({ ...act, minutes: timeToMinutes(act.time) - nowMin }))
    .filter(act => act.minutes > 0)
    .sort((a, b) => a.minutes - b.minutes);

  if (upcomingToday.length > 0) {
    const act = upcomingToday[0];
    return { title: act.title, minutes: act.minutes, time: act.time, category: act.category };
  } else {
    for (let i = todayIdx + 1; i < days.length; i++) {
      const nextDay = days[i];
      const nextDayEvents = nextDay.activities.filter(act => act.category.toLowerCase() === 'event');
      if (nextDayEvents.length > 0) {
        const firstActivity = nextDayEvents[0];
        const daysBetween = i - todayIdx;
        const minutesUntil = (daysBetween * 24 * 60) - nowMin + timeToMinutes(firstActivity.time);
        return { title: firstActivity.title, minutes: minutesUntil, time: firstActivity.time, category: firstActivity.category };
      }
    }
  }
  return null;
};

export const getJapanTime = (): Date => {
  // Get current time in Tokyo as a Date object
  // Note: new Date(toLocaleString) is generally safe for simple comparisons
  // but we should be careful. This is the current pattern in the project.
  const japanTimeStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" });
  return new Date(japanTimeStr);
};

let subscriptionsFile = path.join(__dirname, '..', 'subscriptions.json');

export const setSubscriptionsFile = (filePath: string) => {
  subscriptionsFile = filePath;
};

// Main polling function called by the cron job
export const pollAndNotify = async () => {
  if (!fs.existsSync(subscriptionsFile)) return;

  try {
    const itinerary = await fetchItinerary();
    if (!itinerary || !itinerary.days || itinerary.days.length === 0) return;

    const currentTime = getJapanTime();
    const nextEvent = getNextEvent(itinerary.days, currentTime);
    if (!nextEvent) return;

    const data = fs.readFileSync(subscriptionsFile, 'utf8');
    const subscriptions: SubscriptionData[] = JSON.parse(data);
    if (subscriptions.length === 0) return;

    let updatedAny = false;

    for (const sub of subscriptions) {
      const { title, minutes, time, category } = nextEvent;
      const eventKey = `${title}-${time}`;

      // Skip if category is disabled for this user
      if (sub.settings?.disabledCategories?.includes(category)) {
        continue;
      }

      // Check Urgent Threshold
      const urgentThreshold = sub.settings?.notifyUrgentMinutesBefore || 1;
      // We notify if it's within the threshold but NOT yet started (minutes > 0)
      if (minutes > 0 && minutes <= urgentThreshold && sub.lastUrgentEvent !== eventKey) {
        await sendPush(sub, {
          title: `Starting Now: ${title}`,
          body: `Time to head out! (${time})`,
          type: 'urgent',
          tag: 'itinerary-alert'
        });
        sub.lastUrgentEvent = eventKey;
        updatedAny = true;
        continue; // Don't send both at once
      }

      // Check Heads-up Threshold
      const headsUpThreshold = sub.settings?.notifyMinutesBefore || 10;
      if (minutes > 0 && minutes <= headsUpThreshold && sub.lastHeadsUpEvent !== eventKey) {
        await sendPush(sub, {
          title: `Upcoming: ${title}`,
          body: `Starting in ${Math.ceil(minutes)} minutes (${time})`,
          type: 'info',
          tag: 'itinerary-alert'
        });
        sub.lastHeadsUpEvent = eventKey;
        updatedAny = true;
      }
    }

    if (updatedAny) {
      fs.writeFileSync(subscriptionsFile, JSON.stringify(subscriptions, null, 2), 'utf8');
    }

  } catch (error) {
    console.error('Polling error:', error);
  }
};

const sendPush = async (subData: SubscriptionData, payloadObj: Record<string, unknown>) => {
  try {
    const payload = JSON.stringify(payloadObj);
    console.log(`Sending Web Push to device: ${String(payloadObj.title)}`);
    await webPush.sendNotification(subData.subscription, payload);
  } catch (e) {
    console.error('Individual push failed:', e);
  }
};

