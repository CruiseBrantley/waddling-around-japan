/**
 * Resolves the API base URL dynamically.
 *
 * Strategy:
 * - Development (localhost/LAN): Uses Vite's /api proxy → no CORS.
 * - Production: Reads /api-config.json (deployed alongside the app on Firebase
 *   Hosting) to get the live tunnel URL. Falls back to VITE_API_URL baked at
 *   build time, then to '' (same-origin).
 *
 * Call `initApiUrl()` once at app startup (before any fetch). After that,
 * `getApiUrl()` is synchronous and safe to call anywhere.
 */

let _resolvedApiUrl: string | null = null;

function detectLocal(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h.startsWith('192.168.') ||
    h.startsWith('10.') ||
    h.startsWith('172.')
  );
}

/**
 * Initialise the API URL. Call once during app bootstrap (e.g. in main.tsx).
 * Resolves immediately for local dev; fetches /api-config.json for production.
 */
export async function initApiUrl(): Promise<void> {
  // Local dev: always use the Vite proxy
  if (detectLocal()) {
    _resolvedApiUrl = '/api';
    return;
  }

  // Production: try to fetch the live tunnel URL from the hosted config file
  try {
    const resp = await fetch('/api-config.json', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json?.apiUrl && typeof json.apiUrl === 'string') {
        _resolvedApiUrl = json.apiUrl;
        console.log('[API] Resolved URL from /api-config.json:', _resolvedApiUrl);
        return;
      }
    }
  } catch {
    // Ignore – fall through to env / empty fallback
  }

  // Fallback: env variable baked at build time
  if (import.meta.env.VITE_API_URL) {
    _resolvedApiUrl = import.meta.env.VITE_API_URL as string;
    console.log('[API] Resolved URL from VITE_API_URL:', _resolvedApiUrl);
    return;
  }

  // Last resort: same-origin (works if backend is co-hosted)
  _resolvedApiUrl = '';
}

/**
 * Returns the cached API base URL. Must call `initApiUrl()` first.
 */
export function getApiUrl(): string {
  if (_resolvedApiUrl === null) {
    // Synchronous fallback before initApiUrl() completes (shouldn't happen)
    if (detectLocal()) return '/api';
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL as string;
    return '';
  }
  return _resolvedApiUrl;
}
