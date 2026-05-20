/**
 * Resolves the API base URL dynamically.
 * If running on localhost, 127.0.0.1, or a local IP subnet, we talk directly to the local backend port 4000
 * to avoid ngrok limits, latency, and CORS preflight errors when working locally.
 */
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isLocal = 
      hostname === 'localhost' || 
      hostname === '127.0.0.1' || 
      hostname.startsWith('192.168.') || 
      hostname.startsWith('10.') || 
      hostname.startsWith('172.');
      
    if (isLocal) {
      return 'http://localhost:4000';
    }
  }
  return import.meta.env.VITE_API_URL || 'http://localhost:4000';
}
