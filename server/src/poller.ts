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

// Helper to check if a date string matches a Date object
export const isSameDay = (dateStr: string, dateObj: Date) => {
  const localDateStr = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000))
    .toISOString()
    .split('T')[0];
  const cleanDateStr = dateStr.replace(/\//g, '-').split('T')[0];
  return localDateStr === cleanDateStr;
};

export interface AlertTarget {
  title: string;
  minutes: number;
  time: string;
}

export const getNextEvent = (days: ItineraryDay[], currentTime: Date): AlertTarget | null => {
  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes() + (currentTime.getSeconds() / 60);
  const todayIdx = days.findIndex(d => isSameDay(d.date, currentTime));
  if (todayIdx === -1) return null;

  const today = days[todayIdx];
  
  const upcomingToday = today.activities
    .map(act => ({ ...act, minutes: timeToMinutes(act.time) - nowMin }))
    .filter(act => act.minutes > 0)
    .sort((a, b) => a.minutes - b.minutes);

  if (upcomingToday.length > 0) {
    return { title: upcomingToday[0].title, minutes: upcomingToday[0].minutes, time: upcomingToday[0].time };
  } else {
    for (let i = todayIdx + 1; i < days.length; i++) {
      const nextDay = days[i];
      if (nextDay.activities.length > 0) {
        const firstActivity = nextDay.activities[0];
        const daysBetween = i - todayIdx;
        const minutesUntil = (daysBetween * 24 * 60) - nowMin + timeToMinutes(firstActivity.time);
        return { title: firstActivity.title, minutes: minutesUntil, time: firstActivity.time };
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
  const SUBSCRIPTIONS_FILE = path.join(__dirname, '..', 'subscriptions.json');
  if (!fs.existsSync(SUBSCRIPTIONS_FILE)) return;

  try {
    const itinerary = await fetchItinerary();
    if (!itinerary || !itinerary.days || itinerary.days.length === 0) return;

    const currentTime = getJapanTime();
    const nextEvent = getNextEvent(itinerary.days, currentTime);
    if (!nextEvent) return;

    const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
    const subscriptions: SubscriptionData[] = JSON.parse(data);
    if (subscriptions.length === 0) return;

    let updatedAny = false;

    for (const sub of subscriptions) {
      const { title, minutes, time } = nextEvent;
      const eventKey = `${title}-${time}`;

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
      fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2), 'utf8');
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

