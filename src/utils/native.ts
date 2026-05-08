/**
 * Native Integration Utilities
 * Focuses on PWA features that feel like native iOS/Android integrations.
 */

/**
 * Triggers a subtle haptic pulse.
 * Note: navigator.vibrate is supported on Android/Chrome.
 * iOS does not support navigator.vibrate, but this remains for cross-platform.
 */
let _hapticsEnabled = true;
let _vibrateOnAlerts = true;
let _soundOnAlerts = true;

export const setHapticsEnabled = (enabled: boolean) => { _hapticsEnabled = enabled; };
export const setVibrateOnAlerts = (enabled: boolean) => { _vibrateOnAlerts = enabled; };
export const setSoundOnAlerts = (enabled: boolean) => { _soundOnAlerts = enabled; };

export const triggerHaptic = (type: 'light' | 'medium' | 'heavy' = 'light') => {
  if (!navigator.vibrate || !_hapticsEnabled) return;

  // Modern Android motors (like OnePlus 13) can be subtle; increased duration for better feedback
  const patterns = {
    light: [25],         // Sharp, noticeable tap
    medium: [60],        // Clear confirmation
    heavy: [120, 40, 120] // Powerful dual-pulse for alerts (slightly increased)
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

// Prime the AudioContext on the very first user gesture so swipes work later.
const primeAudio = () => {
  const ctx = getTickContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
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
  
  // Clean up all listeners
  ['touchstart', 'mousedown', 'click', 'touchend'].forEach(type => {
    document.removeEventListener(type, primeAudio, true);
  });
};

['touchstart', 'mousedown', 'click', 'touchend'].forEach(type => {
  document.addEventListener(type, primeAudio, { capture: true, once: true });
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
    if (!ctx || !_soundOnAlerts) return;

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
export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) return 'unsupported';
  
  try {
    const permission = await Notification.requestPermission();
    console.log('Notification permission status:', permission);
    return permission;
  } catch (e) {
    console.error('Permission request failed', e);
    return 'denied';
  }
};

/**
 * Schedules a local notification.
 * Note: In a pure PWA, local scheduling is limited. 
 * Real "proactive" notifications usually require a backend + Web Push.
 * However, if the tab is open, we can show a non-push Notification.
 */
export const showLocalNotification = async (title: string, body: string, type: 'info' | 'urgent' = 'info') => {
  console.log('Attempting notification:', title, body, type);
  
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
    tag: 'itinerary-alert',
    renotify: true,
    vibrate: _vibrateOnAlerts ? (type === 'urgent' ? [150, 50, 150, 50, 150] : [120, 40, 120]) : [],
    data: {
      url: window.location.origin
    }
  };

  try {
    if (_vibrateOnAlerts) {
      triggerHaptic(type === 'urgent' ? 'heavy' : 'medium');
    }
    
    if (_soundOnAlerts) {
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
