/**
 * Native Integration Utilities
 * Focuses on PWA features that feel like native iOS/Android integrations.
 */

/**
 * Triggers a subtle haptic pulse.
 * Note: navigator.vibrate is supported on Android/Chrome.
 * iOS does not support navigator.vibrate, but this remains for cross-platform.
 */
import { getApiUrl } from './api';

let _hapticsEnabled = true;

export const setHapticsEnabled = (enabled: boolean) => { _hapticsEnabled = enabled; };
// Removed global alert setters in favor of per-notification parameters

export const triggerHaptic = (type: 'light' | 'medium' | 'heavy' = 'light') => {
  if (!navigator.vibrate || !_hapticsEnabled) return;

  // Modern Android motors require slightly longer durations to reliably spin up and actuate tactile feedback
  const patterns = {
    light: [45],          // Sharp, noticeable tactile tap
    medium: [75],         // Clear, satisfying confirmation pulse
    heavy: [130, 45, 130] // Powerful, highly physical dual-pulse for alerts
  };

  navigator.vibrate(patterns[type]);
};

/**
 * Shared AudioContext for tick sounds.
 * Browsers require AudioContext to be created/resumed after a user gesture
 * (tap/click). Swipes alone don't qualify, so we initialize on the first
 * interaction and reuse the same context for all subsequent ticks.
 */
let _tickCtx: AudioContext | null = null;

const getTickContext = (): AudioContext | null => {
  if (_tickCtx && _tickCtx.state !== 'closed') return _tickCtx;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    _tickCtx = new Ctor();
    return _tickCtx;
  } catch { return null; }
};

// Prime the AudioContext on user gestures so swipes work later.
// Uses a self-healing listener: leaves listeners active if the browser blocks the first touchstart,
// and only cleans up once the state successfully transitions to 'running'.
const primeAudio = () => {
  const ctx = getTickContext();
  if (!ctx) return;

  const cleanupListeners = () => {
    ['touchstart', 'mousedown', 'click', 'touchend'].forEach(type => {
      document.removeEventListener(type, primeAudio, true);
    });
  };

  if (ctx.state === 'suspended') {
    ctx.resume()
      .then(() => {
        if (ctx.state === 'running') {
          cleanupListeners();
        }
      })
      .catch(() => {});
  }

  // Create and play a silent buffer — this is often more effective than 
  // just calling resume() for "unlocking" the audio engine on iOS/mobile.
  try {
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch (e) {
    console.warn('Audio priming failed:', e);
  }
  
  if (ctx.state === 'running') {
    cleanupListeners();
  }
};

['touchstart', 'mousedown', 'click', 'touchend'].forEach(type => {
  document.addEventListener(type, primeAudio, { capture: true });
});

/**
 * Plays a subtle "tick" sound for tactile feedback.
 * Uses Web Audio API to generate the sound programmatically.
 */
export const triggerTick = () => {
  try {
    const ctx = getTickContext();
    if (!ctx) return;

    // Try to resume if suspended (common on iOS/mobile)
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      if (ctx.state === 'suspended') return;
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    // Smoother sine wave for a "blunter" tactile feel
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(400, ctx.currentTime);

    // Subtler gain envelope
    gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.008);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.01);
  } catch {
    // Fail silently
  }
};

/**
 * Plays a more distinct "alert" chime for arrival notifications.
 */
export const triggerAlertSound = (type: 'info' | 'urgent' = 'info') => {
  try {
    const ctx = getTickContext();
    if (!ctx) return;

    // On iOS/mobile, the context might be suspended if backgrounded.
    // We try to resume it, though it may only work if we are still active.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      // If still suspended, we likely can't play sound right now
      if (ctx.state === 'suspended') return;
    }

    const playTone = (freq: number, start: number, duration: number, gainVal = 0.12) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(gainVal, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.05);
    };

    const now = ctx.currentTime;
    if (type === 'urgent') {
      // More intense three-tone rising chime
      playTone(523.25, now, 0.15);       // C5
      playTone(659.25, now + 0.12, 0.15); // E5
      playTone(783.99, now + 0.24, 0.3);  // G5
    } else {
      // Simple double-tone chime
      playTone(660, now, 0.15);      // E5
      playTone(880, now + 0.1, 0.2); // A5
    }
  } catch {
    // Fail silently
  }
};

/**
 * Requests notification permission.
 */
export const requestNotificationPermission = async (settings: { notifyMinutesBefore: number, notifyUrgentMinutesBefore: number, devMode: boolean, disabledCategories: string[] }) => {
  if (!('Notification' in window)) return 'unsupported';
  
  try {
    const permission = await Notification.requestPermission();
    console.log('Notification permission status:', permission);
    
    if (permission === 'granted') {
      await subscribeToPushNotifications(settings);
    }
    
    return permission;
  } catch (e) {
    console.error('Permission request failed', e);
    return 'denied';
  }
};

/**
 * Utility to convert the base64 VAPID public key into the format required by PushManager
 */
const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

/**
 * Subscribes the device to Web Push and sends the subscription to the backend.
 */
export const subscribeToPushNotifications = async (settings: { notifyMinutesBefore: number, notifyUrgentMinutesBefore: number, devMode: boolean, disabledCategories: string[], debugOffset?: number | null }) => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push messaging is not supported.');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || (window as unknown as { VITE_VAPID_PUBLIC_KEY?: string }).VITE_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      console.error('Missing VITE_VAPID_PUBLIC_KEY in .env or window');
      return;
    }

    const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

    // Subscribe to push notifications
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedVapidKey
    });

    console.log('Push subscription successful. Sending to backend...');

    // Send the subscription to our backend server
    const apiUrl = getApiUrl();
    const response = await fetch(`${apiUrl}/subscribe`, {
      method: 'POST',
      body: JSON.stringify({ 
        subscription: subscription.toJSON(), 
        settings: {
          notifyMinutesBefore: settings.notifyMinutesBefore,
          notifyUrgentMinutesBefore: settings.notifyUrgentMinutesBefore,
          disabledCategories: settings.disabledCategories,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          debugOffset: settings.debugOffset
        },
        isDev: settings.devMode
      }),
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'Bypass-Tunnel-Reminder': 'true'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error (${response.status}): ${errorText}`);
    }

    console.log('Successfully registered with backend push server.');
  } catch (e) {
    console.error('Failed to subscribe to push notifications:', e);
    throw e;
  }
};

/**
 * Unsubscribes the device from Web Push and removes it from the backend.
 */
export const unsubscribeFromPushNotifications = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      console.log('Unsubscribing device from push...');
      
      // 1. Try to tell backend to delete, but don't let a network failure block local cleanup
      const apiUrl = getApiUrl();
      try {
        const response = await fetch(`${apiUrl}/unsubscribe`, {
          method: 'POST',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            'Bypass-Tunnel-Reminder': 'true'
          }
        });
        
        if (response.ok) {
          console.log('Backend unsubscribed successfully.');
        } else {
          console.warn(`Backend unsubscribe returned status ${response.status}`);
        }
      } catch (netError) {
        console.warn('Backend unsubscribe failed (likely offline). Proceeding with local cleanup anyway.', netError);
      }

      // 2. Always unsubscribe locally so the browser state and UI are consistent
      await subscription.unsubscribe();
      console.log('Local browser subscription cleared.');
    }
  } catch (e) {
    console.error('Failed to unsubscribe from push notifications:', e);
    throw e; // Rethrow so the UI knows it failed
  }
};

/**
 * Schedules a local notification.
 * Note: In a pure PWA, local scheduling is limited. 
 * Real "proactive" notifications usually require a backend + Web Push.
 * However, if the tab is open, we can show a non-push Notification.
 */
export const showLocalNotification = async (
  title: string, 
  body: string, 
  type: 'info' | 'urgent' = 'info',
  vibrate = true,
  sound = true,
  renotify = true,
  tag = 'itinerary-alert'
) => {
  console.log('Attempting notification:', title, body, type, 'vibrate:', vibrate, 'sound:', sound, 'renotify:', renotify, 'tag:', tag);
  
  if (!('Notification' in window)) {
    console.warn('Notifications not supported in this browser');
    return;
  }

  if (Notification.permission !== 'granted') {
    console.warn('Notification permission not granted (current:', Notification.permission, ')');
    return;
  }

  const options: NotificationOptions & { [key: string]: unknown } = {
    body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag,
    renotify,
    requireInteraction: true,
    silent: !sound,
    vibrate: vibrate ? (type === 'urgent' ? [150, 50, 150, 50, 150] : [120, 40, 120]) : [],
    data: {
      url: window.location.origin
    }
  };

  try {
    if (vibrate) {
      triggerHaptic(type === 'urgent' ? 'heavy' : 'medium');
    }
    
    if (sound) {
      triggerAlertSound(type);
    }


    // 1. Try Service Worker registration with a timeout to prevent hanging
    if ('serviceWorker' in navigator) {
      // Race the SW ready promise against a 2-second timeout
      const swReady = navigator.serviceWorker.ready;
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('SW Timeout')), 2000));
      
      try {
        const registration = await Promise.race([swReady, timeout]) as ServiceWorkerRegistration;
        if (registration && 'showNotification' in registration) {
          await registration.showNotification(title, options);
          return;
        }
      } catch {
        console.warn('Service Worker not ready or timed out, falling back to Notification API');
      }
    }

    // 2. Fallback to standard Notification API
    new Notification(title, options);
  } catch (e) {
    console.error('Notification failed', e);
  }
};

/**
 * Clears any active itinerary notifications.
 * Ensures the notification tray is clean when the user opens the app.
 */
export const clearEventNotifications = async () => {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    if ('getNotifications' in registration) {
      const notifications = await registration.getNotifications();
      notifications.forEach(n => {
        if (n.tag === 'itinerary-alert' || n.tag === 'itinerary-timer') {
          n.close();
        }
      });
    }
    // Automatically clear the home screen app icon badge count
    clearAppBadge();
  } catch (e) {
    console.warn('Failed to clear notifications:', e);
  }
};

// Expose to window for testing
if (typeof window !== 'undefined') {
  (window as unknown as { showLocalNotification: unknown }).showLocalNotification = showLocalNotification;
}

/**
 * Copies text to clipboard with legacy fallback.
 */
const copyToClipboard = async (text: string) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.error('Clipboard API failed', e);
    }
  }

  // Legacy fallback
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Legacy copy failed', err);
    return false;
  }
};

/**
 * Shares the itinerary link using the native share sheet.
 */
export const shareItinerary = async (title: string, text: string, url: string) => {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
      console.error('Native share failed', e);
    }
  }

  // Fallback: Copy to clipboard
  const success = await copyToClipboard(url);
  if (success) {
    alert('Trip link copied to clipboard! Share it with your friends.');
    return 'copied';
  } else {
    alert('Could not copy link. Please copy the URL from your browser address bar.');
    return 'failed';
  }
};

interface BadgeNavigator {
  setAppBadge?: (count: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/**
 * Updates the app badge (the red number on the app icon).
 * Supported on iOS 16.4+ and most Android/Chrome.
 */
export const setAppBadge = (count: number) => {
  const nav = navigator as unknown as BadgeNavigator;
  if (nav.setAppBadge) {
    nav.setAppBadge(count).catch(console.error);
  }
};

export const clearAppBadge = () => {
  const nav = navigator as unknown as BadgeNavigator;
  if (nav.clearAppBadge) {
    nav.clearAppBadge().catch(console.error);
  }
};
