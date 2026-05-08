export interface AppSettings {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  vibrateOnAlerts: boolean;
  soundOnAlerts: boolean;
  notificationsEnabled: boolean;
  /** Minutes before event to send the first notification */
  notifyMinutesBefore: number;
  /** Minutes before event to send the urgent notification */
  notifyUrgentMinutesBefore: number;
}

export const SETTINGS_DEFAULTS: AppSettings = {
  soundEnabled: true,
  hapticsEnabled: true,
  vibrateOnAlerts: true,
  soundOnAlerts: true,
  notificationsEnabled: false,
  notifyMinutesBefore: 10,
  notifyUrgentMinutesBefore: 1,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('app_settings');
    if (raw) return { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* use defaults */ }
  return { ...SETTINGS_DEFAULTS };
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem('app_settings', JSON.stringify(settings));
}

/** Detect iOS (iPhone, iPad, iPod) */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Check if the app is running in standalone PWA mode */
export function isStandalone(): boolean {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isAppleStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isStandalone || isAppleStandalone;
}

/** Check if the browser supports notifications at all */
export function supportsNotifications(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator;
}
