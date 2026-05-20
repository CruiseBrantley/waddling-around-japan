declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__; // Dynamically injected from package.json via Vite

export interface AppSettings {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  notificationsEnabled: boolean;
  notifyHeadsUpEnabled: boolean;
  notifyHeadsUpChime: boolean;
  notifyHeadsUpVibrate: boolean;
  notifyUrgentEnabled: boolean;
  notifyUrgentChime: boolean;
  notifyUrgentVibrate: boolean;
  /** Minutes before event to send the first notification */
  notifyMinutesBefore: number;
  /** Minutes before event to send the urgent notification */
  notifyUrgentMinutesBefore: number;
  /** Manual time override for testing (e.g. "14:30") */
  debugTime: string | null;
  /** Manual date override for testing (e.g. "2024-05-15") */
  debugDate: string | null;
  /** Milliseconds offset from real time */
  debugOffset: number | null;
  /** Developer mode for testing push notifications */
  devMode: boolean;
  /** List of category names that should NOT trigger notifications */
  disabledCategories: string[];
  /** AI Provider for travel insights: "none" | "gemini" | "gemma" */
  aiProvider: 'none' | 'gemini' | 'gemma';
  /** Gemini API Key */
  geminiApiKey: string;
  /** Gemini Model Name */
  geminiModel: string;
  /** Ollama Endpoint URL */
  ollamaUrl: string;
  /** Ollama Model Name */
  ollamaModel: string;
}

export const SETTINGS_DEFAULTS: AppSettings = {
  soundEnabled: true,
  hapticsEnabled: true,
  notificationsEnabled: false,
  notifyHeadsUpEnabled: true,
  notifyHeadsUpChime: true,
  notifyHeadsUpVibrate: true,
  notifyUrgentEnabled: true,
  notifyUrgentChime: true,
  notifyUrgentVibrate: true,
  notifyMinutesBefore: 10,
  notifyUrgentMinutesBefore: 1,
  debugTime: null,
  debugDate: null,
  debugOffset: null,
  devMode: false,
  disabledCategories: [],
  aiProvider: 'gemma',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  ollamaUrl: 'http://sirian.ddns.net:11434',
  ollamaModel: 'gemma4:26b',
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('app_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      return { 
        ...SETTINGS_DEFAULTS, 
        ...parsed,
        aiProvider: 'gemma',
        ollamaUrl: parsed.ollamaUrl && parsed.ollamaUrl !== 'http://localhost:11434' ? parsed.ollamaUrl : 'http://sirian.ddns.net:11434',
        ollamaModel: parsed.ollamaModel && parsed.ollamaModel.startsWith('gemma4') ? parsed.ollamaModel : 'gemma4:26b'
      };
    }
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

/** Check if the browser supports haptic vibration (navigator.vibrate) */
export function supportsHaptics(): boolean {
  // iOS does not support navigator.vibrate
  return typeof navigator !== 'undefined' && !!navigator.vibrate && !isIOS();
}

/** Check if the browser supports Web Audio API */
export function supportsSound(): boolean {
  return typeof window !== 'undefined' && !!(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
}
