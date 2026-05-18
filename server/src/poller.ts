import { fetchItinerary, ItineraryDay } from './sheets';
import webPush from 'web-push';
import fs from 'fs';
import path from 'path';
import { SubscriptionData } from './app';

// Helper to convert "HH:MM" to minutes from midnight (handles both 24h and 12h AM/PM formats)
export const timeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d+):(\d+)(?:\s*(am|pm))?/i);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3]?.toLowerCase();
  
  if (ampm === 'pm' && hours < 12) {
    hours += 12;
  } else if (ampm === 'am' && hours === 12) {
    hours = 0;
  }
  return (hours * 60) + minutes;
};

// Helper to check if a date string matches a Date object (in local/Japan timezone)
export const isSameDay = (dateStr: string, dateObj: Date, timeZone: string = 'Asia/Tokyo') => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(dateObj);
  
  const targetYear = parseInt(parts.find(p => p.type === 'year')!.value, 10);
  const targetMonth = parseInt(parts.find(p => p.type === 'month')!.value, 10);
  const targetDay = parseInt(parts.find(p => p.type === 'day')!.value, 10);

  let cleanDateStr = dateStr;
  const match = dateStr.match(/\d/);
  if (match) cleanDateStr = dateStr.substring(match.index!);

  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(cleanDateStr)) {
    const parts = cleanDateStr.split('T')[0].split(/[-/]/).map(s => parseInt(s, 10));
    return parts[0] === targetYear && parts[1] === targetMonth && parts[2] === targetDay;
  }

  const slashParts = cleanDateStr.split('/');
  if (slashParts.length >= 3) {
    const m = parseInt(slashParts[0], 10);
    const d = parseInt(slashParts[1], 10);
    let y = parseInt(slashParts[2], 10);
    if (y < 100) y += 2000;
    return y === targetYear && m === targetMonth && d === targetDay;
  }

  const parsedDate = new Date(cleanDateStr);
  if (!isNaN(parsedDate.getTime())) {
    return parsedDate.getFullYear() === targetYear &&
           (parsedDate.getMonth() + 1) === targetMonth &&
           parsedDate.getDate() === targetDay;
  }

  return false;
};

export interface AlertTarget {
  title: string;
  minutes: number;
  time: string;
  category: string;
}

// Helper to get minutes from midnight in local/Japan time
export const getJapanMinutes = (date: Date, timeZone: string = 'Asia/Tokyo'): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
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

export const getNextEvent = (days: ItineraryDay[], currentTime: Date, timeZone: string = 'Asia/Tokyo'): AlertTarget | null => {
  const nowMin = getJapanMinutes(currentTime, timeZone);
  const todayIdx = days.findIndex(d => isSameDay(d.date, currentTime, timeZone));
  if (todayIdx === -1) return null;

  const today = days[todayIdx];
  
  const upcomingToday = today.activities
    .filter(act => act.time)
    .map(act => ({ ...act, minutes: timeToMinutes(act.time) - nowMin }))
    .filter(act => act.minutes > 0)
    .sort((a, b) => a.minutes - b.minutes);

  if (upcomingToday.length > 0) {
    const act = upcomingToday[0];
    return { title: act.title, minutes: act.minutes, time: act.time, category: act.category };
  } else {
    for (let i = todayIdx + 1; i < days.length; i++) {
      const nextDay = days[i];
      const nextDayEvents = nextDay.activities.filter(act => act.time);
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
  // Return the absolute current time. Timezone conversions are safely handled
  // down the line in getJapanMinutes and isSameDay using Intl.DateTimeFormat.
  return new Date();
};

let subscriptionsFile = path.join(__dirname, '..', 'subscriptions.json');

export const setSubscriptionsFile = (filePath: string) => {
  subscriptionsFile = filePath;
};

// Main polling function called by the cron job or the API endpoint
export const pollAndNotify = async (mockTime?: Date) => {
  if (!fs.existsSync(subscriptionsFile)) return;

  try {
    const itinerary = await fetchItinerary();
    if (!itinerary || !itinerary.days || itinerary.days.length === 0) return;

    const data = fs.readFileSync(subscriptionsFile, 'utf8');
    const subscriptions: SubscriptionData[] = JSON.parse(data);
    if (subscriptions.length === 0) return;

    const currentTime = mockTime || getJapanTime();
    let updatedAny = false;

    for (const sub of subscriptions) {
      const userTimezone = sub.settings?.timezone || 'Asia/Tokyo';
      
      // Support frontend mock debug time/date offset if devMode is active
      let userTime = currentTime;
      if (sub.isDev && typeof sub.settings?.debugOffset === 'number') {
        userTime = new Date(currentTime.getTime() + sub.settings.debugOffset);
      }

      const nextEvent = getNextEvent(itinerary.days, userTime, userTimezone);
      if (!nextEvent) continue;

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
    await webPush.sendNotification(subData.subscription, payload, {
      urgency: 'high',
      TTL: 3600 // 1 hour Time-to-Live
    });
  } catch (e) {
    console.error('Individual push failed:', e);
  }
};

