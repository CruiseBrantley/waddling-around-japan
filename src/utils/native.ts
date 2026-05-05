/**
 * Native Integration Utilities
 * Focuses on PWA features that feel like native iOS/Android integrations.
 */

/**
 * Triggers a subtle haptic pulse.
 * Note: navigator.vibrate is supported on Android/Chrome.
 * iOS does not support navigator.vibrate, but this remains for cross-platform.
 */
export const triggerHaptic = (type: 'light' | 'medium' | 'heavy' = 'light') => {
  if (!navigator.vibrate) return;

  const patterns = {
    light: [10],
    medium: [20],
    heavy: [50]
  };

  navigator.vibrate(patterns[type]);
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
export const showLocalNotification = async (title: string, body: string) => {
  console.log('Attempting notification:', title, body);
  
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
    vibrate: [100, 50, 100],
    data: {
      url: window.location.origin
    }
  };

  try {
    triggerHaptic('medium');

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
