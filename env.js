/**
 * Environment Configuration
 * 
 * Loads configuration constants for the BTTC Round Robin Registration app.
 * For production, you can override these values by creating a custom env.js file.
 */

const ENV = {
  // API Configuration
  API_URL: 'http://0.0.0.0:8080',
  API_KEY: 'secret', // Optional: Set API key for local dev (e.g., 'your-api-key-here')
  
  // Support Contact
  SUPPORT_PHONE: '510-926-6913',
  SUPPORT_METHOD: 'TEXT ONLY',
  
  // Registration Schedule
  REGISTRATION_DAY: 5, // Friday (0 = Sunday, 5 = Friday)
  REGISTRATION_CLOSING_HOUR: 18,
  REGISTRATION_CLOSING_MINUTE: 45,
  TIMEZONE: 'America/Los_Angeles',
  
  // Capacity Settings
  DEFAULT_PLAYER_CAP: 64,
  FALLBACK_PLAYER_CAP: 65,
  
  // Phone Validation
  PHONE_NUMBER_LENGTH: 10,
  PHONE_COUNTRY_CODE: 1,
  
  // Development
  DEV_OVERRIDE: true
};

