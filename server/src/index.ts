import { app } from './app';
import dotenv from 'dotenv';
import webPush from 'web-push';
import cron from 'node-cron';
import { pollAndNotify, generateMissingAdvisories } from './poller';

dotenv.config();

const PORT = process.env.PORT || 4000;

// Configure Web Push with our VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@yourdomain.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('VAPID keys not fully configured in .env!');
}

// Schedule the polling job to run every minute
cron.schedule('* * * * *', () => {
  pollAndNotify();
});

// Schedule the advisor generation job to run every hour
cron.schedule('0 * * * *', () => {
  generateMissingAdvisories();
});

app.listen(PORT, () => {
  console.log(`Waddling Push Server is running on port ${PORT}`);
  console.log(`VAPID Public Key: ${process.env.VAPID_PUBLIC_KEY?.substring(0, 10)}...`);
  console.log('Cron job started: Polling itinerary every minute.');
  
  // Proactively run the advisor generator scan immediately on startup
  console.log('Server Startup: Initiating proactive AI Advisor pre-cache scan...');
  generateMissingAdvisories();
});
