// BTTC Shared Utilities
// Common functions used across Vue.js applications

/**
 * The player-facing half of `bttc_api/helpers/errors.py`'s registry.
 *
 * Ticket 28 Q2 converted `POST /rr/register`, `POST /rr/unregister` and
 * `POST /player/signup` from `{"success": false}`-in-a-200 to a status code plus a
 * machine-readable `code`. These are the six codes those three endpoints can raise.
 *
 * **Why this is not a copy of `leaguemanager/api.js`'s WIRE_CODES.** That table is
 * operator-voiced -- *"Use the desk controls on the Roster tab"* -- and
 * `leaguemanager/test/api.test.js` actively FORBIDS the support phone number in it,
 * because the operator is the person you would be calling. These pages are the opposite
 * case: the reader is a player on a registration form, the phone number is exactly the
 * right remedy, and `getErrorMessage()` already appends it. So the mapping is small and
 * the fallback is the shared one.
 *
 * `api.js` is an ES module and this is a classic script loaded by `<script src>`, so it
 * could not import that table even if the wording suited.
 *
 * **A code with no entry here is not an error.** It falls through to
 * `getErrorMessage()`, which is what handles INTERNAL, DB_BUSY, a proxy `NOT_FOUND` or
 * `PROXY_ERROR`, and anything a later ticket coins before this map hears about it.
 */
const WIRE_MESSAGES = Object.freeze({
  ALREADY_REGISTERED: 'You are already registered for this event.',
  EVENT_CLOSED:       'Registration for this event is closed.',
  NOT_REGISTERED:     'You are not registered for this event.',
  INVALID_PIN:        'That PIN does not match.',
  PLAYER_NOT_FOUND:   'We could not find that player in the system.',
  ALREADY_SIGNED_UP:  'That player has already completed their signup.',
});

/**
 * The message for a thrown error, preferring the registry code when there is one.
 *
 * Ticket 28 Q2. Everything without a `code` -- and every code this map does not carry --
 * takes the `getErrorMessage()` path unchanged, support phone number and all.
 */
const getWireErrorMessage = (error, context = 'operation') => {
  const mapped = error && error.code ? WIRE_MESSAGES[error.code] : null;
  return mapped || getErrorMessage(error, context);
};

const getSupportContact = () => {
  return typeof ENV !== 'undefined' 
    ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
    : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
};

const getErrorMessage = (error, context = 'operation') => {
  const errorMessage = error?.message || String(error || '');
  const errorName = error?.name || '';
  const supportContact = getSupportContact();
  
  // Network errors
  if (
    error instanceof TypeError ||
    errorName === 'TypeError' ||
    errorMessage.includes('Failed to fetch') ||
    errorMessage.includes('NetworkError') ||
    errorMessage.includes('Network request failed') ||
    errorMessage.includes('ERR_INTERNET_DISCONNECTED') ||
    errorMessage.includes('ERR_CONNECTION_REFUSED') ||
    errorMessage.includes('ERR_CONNECTION_TIMED_OUT') ||
    errorMessage.includes('ERR_TIMED_OUT') ||
    errorMessage.includes('Load failed')
  ) {
    return `Unable to connect to the server. The service may be temporarily unavailable. Please try again in a few moments or ${supportContact}.`;
  }
  
  // HTTP errors
  if (error && error.response) {
    const status = error.response.status;
    
    if (status === 0) {
      return `Connection error: The server is unreachable. Please try again later or ${supportContact}.`;
    }
    // 503 MUST be tested before the `>= 500` catch-all. It was written after it, so it
    // was dead code -- and ticket 28 Q9's DB_BUSY is a 503, which is exactly the case
    // where "try again" is true and "technical difficulties" is not.
    if (status === 503) {
      return `Service unavailable: The service is temporarily busy. Please try again in a moment or ${supportContact}.`;
    }
    if (status >= 500) {
      return `Server error: The service is experiencing technical difficulties. Please try again in a few moments or ${supportContact}.`;
    }
    if (status === 404) {
      return `Service not found. Please ${supportContact}.`;
    }
  }
  
  // Generic errors
  if (error && error.message) {
    return `An error occurred during ${context}: ${error.message}. Please try again or ${supportContact}.`;
  }
  
  return `An unexpected error occurred during ${context}. Please try again or ${supportContact}.`;
};

const getFetchOptions = (options = {}) => {
  const apiKey = typeof ENV !== 'undefined' ? ENV.API_KEY : '';
  
  if (apiKey) {
    const existingHeaders = options.headers || {};
    const headers = {
      ...(existingHeaders instanceof Headers 
        ? Object.fromEntries(existingHeaders.entries()) 
        : existingHeaders),
      'X-API-Key': apiKey
    };
    
    return {
      ...options,
      headers: headers
    };
  }
  
  return options;
};

const handleApiResponse = async (response) => {
  if (!response.ok) {
    let errorMessage = 'Server error';
    let errorCode = null;
    let errorDetail = null;
    try {
      const errorData = await response.json();
      // FastAPI returns errors as {"detail": "..."}; check it first so API messages
      // (e.g. "An OPEN event for this type and date already exists.") reach the user
      // instead of the generic fallback.
      errorMessage = errorData.detail || errorData.message || errorData.error || errorMessage;
      // Ticket 28 Q2: the machine-readable `code` used to be read into scope here and
      // then dropped on the floor. `error.response` cannot carry it -- `.json()` above
      // has already drained the stream, so `error.response.json()` rejects downstream --
      // so the three fields are lifted onto the Error itself.
      errorCode = typeof errorData.code === 'string' ? errorData.code : null;
      errorDetail = typeof errorData.detail === 'string' ? errorData.detail : null;
    } catch {
      errorMessage = response.statusText || `HTTP ${response.status}`;
    }
    
    const error = new Error(errorMessage);
    error.response = response;
    error.status = response.status;
    error.code = errorCode;
    error.detail = errorDetail;
    throw error;
  }
  
  try {
    return await response.json();
  } catch (jsonError) {
    throw new Error('Invalid response from server. Please try again.');
  }
};

const validatePhone = (phone) => {
  const digitsOnly = phone.replace(/\D/g, '');
  const cleaned = digitsOnly.replace(/^1/, '');
  const requiredLength = typeof ENV !== 'undefined' ? ENV.PHONE_NUMBER_LENGTH : 10;
  
  if (!cleaned) {
    return { valid: false, message: 'Please enter a phone number.' };
  }
  
  if (cleaned.length < requiredLength) {
    return { valid: false, message: `Phone number must be at least ${requiredLength} digits.` };
  }
  
  if (cleaned.length > requiredLength) {
    return { valid: false, message: `Phone number must be exactly ${requiredLength} digits.` };
  }
  
  const areaCode = cleaned.substring(0, 3);
  if (areaCode[0] === '0' || areaCode[0] === '1') {
    return { valid: false, message: 'Invalid area code. Area codes cannot start with 0 or 1.' };
  }
  
  const exchangeCode = cleaned.substring(3, 6);
  if (exchangeCode[0] === '0' || exchangeCode[0] === '1') {
    return { valid: false, message: 'Invalid phone number format.' };
  }
  
  return { valid: true, phone: cleaned };
};

const validateEmail = (email) => {
  if (!email || !email.trim()) {
    return { valid: false, message: 'Please enter an email address.' };
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return { valid: false, message: 'Please enter a valid email address.' };
  }
  
  return { valid: true };
};

const validateToken = (token) => {
  if (!token || !token.trim()) {
    return { valid: false, message: 'Please enter your 6-digit PIN.' };
  }
  
  const cleaned = token.trim().replace(/\D/g, '');
  if (cleaned.length !== 6) {
    return { valid: false, message: 'PIN must be exactly 6 digits.' };
  }
  
  return { valid: true, token: cleaned };
};

const formatPhoneNumber = (phoneString) => {
  // Remove all non-numeric characters
  const cleaned = phoneString.replace(/\D/g, '').slice(0, 10);
  
  // Format as xxx-xxx-xxxx
  if (cleaned.length <= 3) {
    return cleaned;
  } else if (cleaned.length <= 6) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  } else {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
};

// Obfuscation decoders.
// Contact details are stored encoded so they cannot be lifted out of the served
// source, and are decoded at render time. Same schemes the static pages use:
// ROT13 for text (about.html), digits-multiplied-by-3 for phone numbers
// (coaching.html, index.html).
const rot13 = (s) => {
  return s.replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
};

const decodeObfuscatedDigits = (s) => {
  return s.replace(/\d+/g, match => parseInt(match) / 3);
};

// Cookie utilities for storing phone number for auto-sign-in
const setCookie = (name, value, days = 365) => {
  // Set cookie with expiration date
  const expires = new Date();
  expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
};

const getCookie = (name) => {
  // Get cookie value by name
  const nameEQ = name + '=';
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
};

const deleteCookie = (name) => {
  // Delete cookie by setting expiration to past date
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
};

