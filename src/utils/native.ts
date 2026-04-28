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
  
  const permission = await Notification.requestPermission();
  return permission;
};

/**
 * Schedules a local notification.
 * Note: In a pure PWA, local scheduling is limited. 
 * Real "proactive" notifications usually require a backend + Web Push.
 * However, if the tab is open, we can show a non-push Notification.
 */
export const showLocalNotification = (title: string, body: string) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    new Notification(title, {
      body,
      icon: '/icon.png',
      badge: '/icon.png',
      tag: 'itinerary-alert'
    });
  } catch (e) {
    // Some mobile browsers require service worker registration for notifications
    console.error('Notification failed', e);
  }
};

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

interface ExtendedNavigator extends Navigator {
  setAppBadge?: (count: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/**
 * Updates the app badge (the red number on the app icon).
 * Supported on iOS 16.4+ and most Android/Chrome.
 */
export const setAppBadge = (count: number) => {
  const nav = navigator as ExtendedNavigator;
  if (nav.setAppBadge) {
    nav.setAppBadge(count).catch(console.error);
  }
};

export const clearAppBadge = () => {
  const nav = navigator as ExtendedNavigator;
  if (nav.clearAppBadge) {
    nav.clearAppBadge().catch(console.error);
  }
};
