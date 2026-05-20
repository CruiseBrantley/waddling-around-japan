/**
 * Resolves the API base URL dynamically.
 * 
 * Development mode (localhost/127.0.0.1):
 *   Uses the '/api' prefix so that Vite's dev proxy intercepts and forwards to the backend.
 *   This completely eliminates CORS issues during development.
 * 
 * Production mode (Firebase Hosting, deployed, etc.):
 *   Returns a relative URL ('') so requests are same-origin against the Firebase-hosted backend.
 *   The server's CORS middleware handles cross-origin validation.
 * 
 * Custom deployments:
 *   Can be overridden via VITE_API_URL environment variable.
 */
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isLocal = 
      hostname === 'localhost' || 
      hostname === '127.0.0.1' || 
      hostname === '::1' || 
      hostname.startsWith('192.168.') || 
      hostname.startsWith('10.') || 
      hostname.startsWith('172.');
      
    if (isLocal) {
      // Use /api prefix for Vite proxy in development
      return '/api';
    }
  }
  
  // Allow override via environment variable (for custom deployments)
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  // Production: use relative URL for same-origin requests against Firebase Hosting
  // Firebase Functions/Hosting can be configured with proper CORS headers
  return '';
}
