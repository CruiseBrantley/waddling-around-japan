export interface AppSettings {
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  /** Minutes before event to send the first notification */
  notifyMinutesBefore: number;
  /** Minutes before event to send the urgent notification */
  notifyUrgentMinutesBefore: number;
}

export const SETTINGS_DEFAULTS: AppSettings = {
  soundEnabled: true,
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

/** Detect iOS (iPhone, iPad, iPod) — notifications are unsupported */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Check if the browser supports notifications at all */
export function supportsNotifications(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator && !isIOS();
}
