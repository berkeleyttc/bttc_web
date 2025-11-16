/**
 * Environment Configuration
 * 
 * Loads configuration constants for the BTTC Round Robin Registration app.
 * For production, you can override these values by creating a custom env.js file.
 */

const ENV = {
  // API Configuration
  API_URL: '/.netlify/functions/api', // Netlify function endpoint (for local dev, use 'http://0.0.0.0:8080')
  // API_KEY: 'secret', // Optional: Set API key for local dev (e.g., 'your-api-key-here')
  
  // Support Contact
  SUPPORT_PHONE: '510-926-6913',
  SUPPORT_METHOD: 'TEXT ONLY',
  
  // Registration Schedule
  // Opening time (when registration opens each week)
  REGISTRATION_OPENING_DAY: 3, // Wednesday (0 = Sunday, 1 = Monday, ..., 3 = Wednesday)
  REGISTRATION_OPENING_HOUR: 0, // 00:00 (midnight)
  REGISTRATION_OPENING_MINUTE: 0,
  
  // Closing time (when registration closes each week)
  REGISTRATION_CLOSING_DAY: 5, // Friday (0 = Sunday, 5 = Friday)
  REGISTRATION_CLOSING_HOUR: 18, // 18:45 (6:45 PM)
  REGISTRATION_CLOSING_MINUTE: 45,
  
  TIMEZONE: 'America/Los_Angeles',
  
  // Capacity Settings
  DEFAULT_PLAYER_CAP: 64,
  FALLBACK_PLAYER_CAP: 65,
  
  // Cache Settings (Time To Live in seconds)
  CACHE_TTL_ROSTER: 60,      // Roster cache TTL in seconds (default: 45s, range: 30-60s)
  
  // Phone Validation
  PHONE_NUMBER_LENGTH: 10,
  PHONE_COUNTRY_CODE: 1,
  
  // Development
  // DEV_OVERRIDE: true
  DEV_OVERRIDE: true
  DEV_OVERRIDE: true,
  
  // Registration Control
  // If true, registration is closed regardless of schedule (priority: DEV_OVERRIDE > REGISTRATION_CLOSED > normal schedule)
  REGISTRATION_CLOSED: false
};

