/**
 * BTTC Round Robin Registration - Vue.js
 * 
 * Simple and elegant registration form for Round Robin tournament registration.
 * 
 * APPLICATION OVERVIEW:
 * This Vue.js application allows players to register for Round Robin tournaments
 * by entering their phone number. It shows registration status, capacity, and
 * allows players to view, register, and unregister.
 * 
 * COMPONENT STRUCTURE:
 * - RegistrationStatus: Shows whether registration is open/closed with time info
 * - PlayerLookup: Phone number input and lookup (with history from localStorage)
 * - PlayerList: Displays players found by phone number, allows registration/unregistration
 * - RegistrationDialog: Modal confirmation dialog for registration
 * - UnregistrationDialog: Modal confirmation dialog for unregistration
 * - RegistrationApp: Main app component that orchestrates the flow
 * 
 * APPLICATION FLOW:
 * 1. App checks registration status (time-based, configurable via ENV)
 * 2. User enters phone number → PlayerLookup component
 * 3. API lookup by phone → /rr/search endpoint
 * 4. Players found → PlayerList component shows matches
 * 5. User clicks Register → Opens RegistrationDialog
 * 6. User confirms → POST to /rr/register API
 * 7. Success → Updates player list, shows confirmation
 * 
 * REGISTRATION RULES (configurable via ENV):
 * - Opens: Configurable day/time (default: Wednesday at 00:00/midnight)
 * - Closes: Configurable day/time (default: Friday at 18:45/6:45 PM)
 * - Capacity check before allowing registration
 * - Configure via REGISTRATION_OPENING_DAY, REGISTRATION_OPENING_HOUR, REGISTRATION_OPENING_MINUTE
 * - Configure via REGISTRATION_CLOSING_DAY, REGISTRATION_CLOSING_HOUR, REGISTRATION_CLOSING_MINUTE
 * 
 * @file js/rr-registration-vue.js
 */

const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

// ========================================
// ERROR HANDLING UTILITY
// ========================================

/**
 * Converts technical errors into user-friendly messages
 * 
 * This function normalizes various error types (network errors, HTTP errors, etc.)
 * into messages that users can understand, with support contact information.
 * 
 * @param {Error|object} error - The error object from try/catch or API response
 * @param {string} context - Context of the operation (e.g., 'player lookup', 'registration')
 * @returns {string} - User-friendly error message with support contact info
 */
const getErrorMessage = (error, context = 'operation') => {
  const errorMessage = error?.message || String(error || '');
  const errorName = error?.name || '';
  
  // Check for network-related errors (API down, connection refused, timeout, etc.)
  // These occur when the server is unreachable, not just when API returns an error
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
    const supportContact = typeof ENV !== 'undefined' 
      ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
      : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
    return `Unable to connect to the server. The registration service may be temporarily unavailable. Please try again in a few moments or ${supportContact}.`;
  }
  
  // Check for HTTP response errors (server returned an error status code)
  // These occur when the server is reachable but returns an error (4xx, 5xx)
  if (error && error.response) {
    const status = error.response.status;
    
    const supportContact = typeof ENV !== 'undefined' 
      ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
      : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
    
    if (status === 0) {
      return `Connection error: The server is unreachable. Please try again later or ${supportContact}.`;
    }
    if (status >= 500) {
      return `Server error: The registration service is experiencing technical difficulties. Please try again in a few moments or ${supportContact}.`;
    }
    if (status === 404) {
      return `Service not found. Please ${supportContact}.`;
    }
    if (status === 503) {
      return `Service unavailable: The registration service is temporarily down for maintenance. Please try again later or ${supportContact}.`;
    }
  }
  
  // Generic error fallback
  if (error && error.message) {
    const supportContact = typeof ENV !== 'undefined' 
      ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
      : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
    return `An error occurred during ${context}: ${error.message}. Please try again or ${supportContact}.`;
  }
  
  const supportContact = typeof ENV !== 'undefined' 
    ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
    : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
  return `An unexpected error occurred during ${context}. Please try again or ${supportContact}.`;
};

/**
 * Creates fetch options with API authentication headers if configured
 * 
 * This function ensures all API requests include the X-API-Key header when
 * ENV.API_KEY is set. It handles both plain object headers and Headers objects.
 * 
 * WHY: The backend API requires authentication via X-API-Key header to prevent
 * unauthorized access. This function centralizes header injection logic.
 * 
 * @param {object} options - Original fetch options (method, headers, body, etc.)
 * @returns {object} - Fetch options with X-API-Key header added if API_KEY is configured
 */
const getFetchOptions = (options = {}) => {
  const apiKey = typeof ENV !== 'undefined' ? ENV.API_KEY : '';
  
  // If API_KEY is configured in env.js, add it to all requests
  if (apiKey) {
    // Handle both Headers object and plain object formats
    // Headers objects need to be converted to plain objects for spreading
    const existingHeaders = options.headers || {};
    const headers = {
      ...(existingHeaders instanceof Headers 
        ? Object.fromEntries(existingHeaders.entries()) 
        : existingHeaders),
      'X-API-Key': apiKey  // Add API key header for authentication
    };
    
    return {
      ...options,
      headers: headers
    };
  }
  
  // No API key configured, return options as-is
  // This allows the app to work without API key (though backend may reject requests)
  return options;
};

/**
 * Handles API response and checks for errors before parsing JSON
 * 
 * This function centralizes response handling:
 * 1. Checks if response.ok (status 200-299)
 * 2. Parses JSON from response
 * 3. Throws errors with context if anything fails
 * 
 * WHY: Centralizes error handling so all API calls handle errors consistently
 * 
 * @param {Response} response - Fetch API Response object
 * @returns {Promise<object>} - Parsed JSON data from successful response
 * @throws {Error} - If response is not OK (non-2xx) or JSON parsing fails
 */
const handleApiResponse = async (response) => {
  // Check if response has an error status (4xx, 5xx, etc.)
  if (!response.ok) {
    let errorMessage = 'Server error';
    try {
      // Try to get error message from JSON response body
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch {
      // If response body isn't JSON, use HTTP status text
      errorMessage = response.statusText || `HTTP ${response.status}`;
    }
    
    // Attach response object to error for getErrorMessage to use
    const error = new Error(errorMessage);
    error.response = response;
    throw error;
  }
  
  // Response is OK, parse JSON body
  try {
    const data = await response.json();
    return data;
  } catch (jsonError) {
    // JSON parsing failed (invalid JSON in response)
    throw new Error('Invalid response from server. Please try again.');
  }
};


// ========================================
// REGISTRATION STATUS COMPONENT
// ========================================

/**
 * RegistrationStatus Component
 * 
 * PURPOSE: Displays whether registration is open or closed, with time information
 * 
 * PROPS:
 * - registrationOpen: Boolean indicating if registration is currently open
 * - closingTime: Formatted string showing when registration closes (if open)
 * - nextOpening: Formatted string showing when registration will next open (if closed)
 * 
 * BEHAVIOR:
 * - Shows "Registration is OPEN" with closing time if open
 * - Shows "Registration is CLOSED" with next opening time if closed
 * - Uses color coding (green for open, red for closed)
 */
const RegistrationStatus = {
  props: {
    isOpen: Boolean,
    closingTime: String,
    nextOpening: String,
    devMode: Boolean
  },
  template: `
    <div class="status-banner" :class="statusClass">
      <div v-if="isOpen">
        🟢 Registration is OPEN<span v-if="devMode"> (DEV MODE)</span>
      </div>
      <div v-else>
        🔴 Registration is CLOSED
      </div>
      <div class="status-details">
        <span v-if="isOpen && !devMode">Closes on closing day at {{ closingTime }} PST</span>
        <span v-else-if="isOpen && devMode">Developer override active</span>
        <span v-else>Next opening: {{ nextOpening }} PST</span>
      </div>
    </div>
  `,
  computed: {
    statusClass() {
      return this.isOpen ? 'status-open' : 'status-closed';
    }
  }
};

// ========================================
// CAPACITY BANNER COMPONENT
// ========================================

/**
 * CapacityBanner Component
 * 
 * PURPOSE: Displays capacity information with last updated timestamp
 * 
 * PROPS:
 * - capacity: Object with capacity info (isAtCapacity, confirmedCount, playerCap, spotsAvailable)
 * - lastUpdated: Timestamp when capacity was last fetched (optional)
 */
const CapacityBanner = {
  props: {
    capacity: Object,
    lastUpdated: Number  // Timestamp in milliseconds, optional
  },
  methods: {
    /**
     * Formats a timestamp into a user-friendly "last updated" string
     * Shows relative time for recent updates (e.g., "5 seconds ago") or formatted time for older
     */
    formatLastUpdated(timestamp) {
      if (!timestamp) return '';
      
      const now = Date.now();
      const age = now - timestamp;
      const seconds = Math.floor(age / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      // Show relative time for recent updates (within 1 hour)
      if (seconds < 60) {
        return seconds <= 1 ? 'just now' : `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
      } else if (minutes < 60) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
      } else if (hours < 1) {
        return 'about an hour ago';
      }
      
      // For older data, show formatted time
      const timezone = typeof ENV !== 'undefined' ? ENV.TIMEZONE : 'America/Los_Angeles';
      const date = new Date(timestamp);
      return date.toLocaleString("en-US", {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    }
  },
  computed: {
    capacityClass() {
      return this.capacity.isAtCapacity ? 'capacity-full' : 'capacity-available';
    },
    lastUpdatedText() {
      return this.formatLastUpdated(this.lastUpdated);
    }
  },
  template: `
    <div class="capacity-banner" :class="capacityClass">
      <div v-if="capacity.isAtCapacity">
        🔴 Registration is FULL
      </div>
      <div v-else>
        🟢 {{ capacity.spotsAvailable }} spots available
      </div>
      <div class="status-details">
        {{ capacity.confirmedCount }}/{{ capacity.playerCap }} spots filled
        <span v-if="lastUpdatedText" class="capacity-last-updated">
          • Updated {{ lastUpdatedText }}
        </span>
      </div>
    </div>
  `
};

// ========================================
// PHONE HISTORY UTILITY
// ========================================

/**
 * Phone History Utilities
 * 
 * PURPOSE: Manages phone number history in localStorage for user convenience
 * 
 * BEHAVIOR:
 * - Stores recently used phone numbers (max 10)
 * - Most recent numbers appear first
 * - Persists across browser sessions via localStorage
 * - Used in PlayerLookup component's datalist for autocomplete
 */

const PHONE_HISTORY_KEY = 'bttc_phone_history';  // localStorage key for phone history
const MAX_HISTORY_ITEMS = 10;                     // Maximum number of phone numbers to store

/**
 * Retrieves phone number history from browser's localStorage
 * 
 * Returns empty array if localStorage is unavailable or corrupted.
 * Used to populate autocomplete datalist in PlayerLookup component.
 * 
 * @returns {string[]} Array of phone numbers (most recent first), empty array on error
 */
const getPhoneHistory = () => {
  try {
    const history = localStorage.getItem(PHONE_HISTORY_KEY);
    return history ? JSON.parse(history) : [];
  } catch (err) {
    // localStorage unavailable or corrupted JSON, return empty array
    return [];
  }
};

/**
 * Saves a phone number to history, maintaining recent-first order
 * 
 * FLOW:
 * 1. Get current history
 * 2. Remove phone if it already exists (to move it to top)
 * 3. Add phone to beginning of array
 * 4. Keep only the most recent MAX_HISTORY_ITEMS entries
 * 5. Save back to localStorage
 * 
 * @param {string} phone - Phone number to save (must be cleaned, 10 digits)
 */
const savePhoneToHistory = (phone) => {
  try {
    const history = getPhoneHistory();
    // Remove if already exists (to move to top on next lookup)
    const filtered = history.filter(p => p !== phone);
    // Add to beginning (most recent first)
    filtered.unshift(phone);
    // Keep only max items (remove oldest entries)
    const trimmed = filtered.slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(PHONE_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // Silent fail - if localStorage is unavailable, just continue without saving history
  }
};

// ========================================
// PLAYER LOOKUP COMPONENT
// ========================================

/**
 * PlayerLookup Component
 * 
 * PURPOSE: Allows users to enter phone number and look up their player account(s)
 * 
 * PROPS:
 * - registrationOpen: Boolean indicating if registration is currently open
 * 
 * BEHAVIOR:
 * - Phone number input with autocomplete from localStorage history
 * - Validates phone number format (10 digits, valid area/exchange codes)
 * - Makes API call to /rr/search?phone=... endpoint (returns { players: [], capacity: {} })
 * - Saves successful lookups to phone history for future use
 * - Shows loading state during API call
 * - Emits 'player-found' with results (includes players and capacity) or 'lookup-error' on failure
 * 
 * VALIDATION RULES:
 * - Removes all non-digits
 * - Removes leading '1' if present (country code)
 * - Must be exactly 10 digits (configurable via ENV.PHONE_NUMBER_LENGTH)
 * - Area code (first 3 digits) cannot start with 0 or 1
 * - Exchange code (next 3 digits) cannot start with 0 or 1
 */
const PlayerLookup = {
  props: {
    registrationOpen: Boolean  // Whether registration is currently open
  },
  emits: ['player-found', 'lookup-error'],
  setup(props, { emit }) {
    // Component state
    const phoneInput = ref('');      // User's phone input (can include formatting)
    const isLookingUp = ref(false);   // Loading state during API call
    const phoneError = ref('');       // Validation/error message
    const phoneHistory = ref([]);     // Phone history from localStorage for autocomplete

    /**
     * Validates and normalizes phone number format
     * 
     * VALIDATION STEPS:
     * 1. Remove all non-digit characters
     * 2. Remove leading '1' if present (US country code)
     * 3. Check length matches required length (default 10 digits)
     * 4. Validate area code format (can't start with 0 or 1)
     * 5. Validate exchange code format (can't start with 0 or 1)
     * 
     * @param {string} phone - Raw phone input (may include formatting like dashes, spaces, parens)
     * @returns {object} - { valid: boolean, phone?: string (cleaned), message?: string (error message) }
     */
    const validatePhone = (phone) => {
      // Remove all non-digits (spaces, dashes, parens, etc.)
      const digitsOnly = phone.replace(/\D/g, '');
      
      // Remove leading 1 if present (US country code)
      const cleaned = digitsOnly.replace(/^1/, '');
      
      // Check if empty after cleaning
      if (!cleaned) {
        return { valid: false, message: 'Please enter a phone number.' };
      }
      
      // Check length matches required (default 10, configurable via ENV)
      const requiredLength = typeof ENV !== 'undefined' ? ENV.PHONE_NUMBER_LENGTH : 10;
      if (cleaned.length < requiredLength) {
        return { valid: false, message: `Phone number must be at least ${requiredLength} digits.` };
      }
      
      if (cleaned.length > requiredLength) {
        return { valid: false, message: `Phone number must be exactly ${requiredLength} digits.` };
      }
      
      // Validate area code (first 3 digits can't start with 0 or 1)
      // This is a US phone number format rule
      const areaCode = cleaned.substring(0, 3);
      if (areaCode[0] === '0' || areaCode[0] === '1') {
        return { valid: false, message: 'Invalid area code. Area codes cannot start with 0 or 1.' };
      }
      
      // Validate exchange code (next 3 digits can't start with 0 or 1)
      // This is a US phone number format rule
      const exchangeCode = cleaned.substring(3, 6);
      if (exchangeCode[0] === '0' || exchangeCode[0] === '1') {
        return { valid: false, message: 'Invalid phone number format.' };
      }
      
      // All validation passed, return cleaned phone number
      return { valid: true, phone: cleaned };
    };

    /**
     * Handles phone lookup form submission
     * 
     * FLOW:
     * 1. Check if registration is open (show alert if closed)
     * 2. Validate phone number format
     * 3. If valid, make API call to /rr/search endpoint
     * 4. On success: Save to history, emit 'player-found' with results
     * 5. On error: Emit 'lookup-error' with user-friendly message
     * 6. Always: Reset loading state
     */
    const handleSubmit = async (e) => {
      e.preventDefault();
      
      // Prevent lookup if registration is closed
      if (!props.registrationOpen) {
        alert('Registration is currently closed. Please check the status banner above for when it will reopen.');
        return;
      }

      // Validate phone number format
      const validation = validatePhone(phoneInput.value);
      if (!validation.valid) {
        phoneError.value = validation.message;
        emit('lookup-error', validation.message);
        return;
      }
      
      // Clear previous errors
      phoneError.value = '';
      const phone = validation.phone;  // Use cleaned phone number

      // Set loading state (disables form, shows spinner)
      isLookingUp.value = true;
      
      try {
        // Make API request to search for players by phone number
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const url = `${apiUrl}/rr/search?phone=${encodeURIComponent(phone)}`;
        
        const fetchOptions = getFetchOptions();
        const response = await fetch(url, fetchOptions);
        const data = await handleApiResponse(response);
        
        // Success: Save phone to history for future autocomplete
        savePhoneToHistory(phone);
        // Refresh history list in UI
        phoneHistory.value = getPhoneHistory();
        
        // Emit results to parent component
        emit('player-found', data);
        
      } catch (error) {
        // Error: Convert to user-friendly message and notify parent
        const friendlyMessage = getErrorMessage(error, 'player lookup');
        emit('lookup-error', friendlyMessage);
      } finally {
        // Always reset loading state (even on error)
        isLookingUp.value = false;
      }
    };

    // Load phone history from localStorage on component mount
    // This populates the autocomplete datalist
    onMounted(() => {
      phoneHistory.value = getPhoneHistory();
    });

    return {
      phoneInput,
      isLookingUp,
      phoneError,
      phoneHistory,
      handleSubmit
    };
  },
  template: `
    <div class="registration-content">
      <div class="lookup-header">
        <h3 class="lookup-title">Find Your Player Account</h3>
        <p class="lookup-description">Enter your phone number to look up your player account</p>
      </div>
      <form @submit="handleSubmit" class="lookup-form">
        <div class="input-wrapper">
          <label for="phone-lookup" class="input-label">Phone Number</label>
          <div class="input-container" :class="{ 'input-error': phoneError }">
            <span class="input-prefix">+1</span>
            <input 
              id="phone-lookup"
              v-model="phoneInput"
              type="tel" 
              maxlength="10" 
              placeholder="5101234567" 
              class="phone-input"
              :class="{ 'input-loading': isLookingUp, 'input-error': phoneError }"
              list="phone-history-list"
              autocomplete="tel"
              required 
              :disabled="isLookingUp"
              @input="phoneError = ''"
            />
            <datalist id="phone-history-list">
              <option v-for="phone in phoneHistory" :key="phone" :value="phone">
                {{ phone }}
              </option>
            </datalist>
            <span v-if="isLookingUp" class="input-spinner"></span>
          </div>
          <p v-if="phoneError" class="input-error-text">{{ phoneError }}</p>
          <p v-else class="input-hint">Enter your 10-digit phone number (e.g., 5101234567)</p>
        </div>
        <button 
          type="submit" 
          class="lookup-button"
          :class="{ 'button-loading': isLookingUp }"
          :disabled="isLookingUp"
        >
          <span v-if="!isLookingUp" class="button-text">
            <span class="button-icon">🔍</span>
            Lookup Player
          </span>
          <span v-else class="button-text">
            <span class="button-spinner"></span>
            Looking up...
          </span>
        </button>
      </form>
    </div>
  `
};

// ========================================
// PLAYER LIST COMPONENT
// ========================================

/**
 * PlayerList Component
 * 
 * PURPOSE: Displays list of players found by phone number, with registration/unregistration actions
 * 
 * PROPS:
 * - players: Array of player objects with registration status
 * - capacity: Object with capacity info (isAtCapacity, confirmedCount, playerCap, spotsAvailable)
 * 
 * BEHAVIOR:
 * - Shows capacity banner if at capacity
 * - Lists all players associated with the phone number
 * - Shows "Register" button for unregistered players
 * - Shows "Unregister" button for registered players
 * - Each button emits event to parent component
 * - Shows "Sign Up Another Player" link if players are found
 * 
 * PLAYER OBJECT STRUCTURE:
 * - bttc_id: Player's BTTC ID
 * - first_name, last_name: Player name
 * - is_registered: Boolean indicating registration status
 * - [other fields may vary]
 */
const PlayerList = {
  props: {
    players: Array,        // Array of player objects from search
    capacity: Object,      // Capacity info: { isAtCapacity, confirmedCount, playerCap, spotsAvailable }
    capacityLastUpdated: Number  // Timestamp when capacity was last fetched (optional)
  },
  emits: ['register-player', 'unregister-player'],
  setup(props, { emit }) {
    /**
     * Handles register button click
     * Emits event to parent with player index
     * 
     * @param {number} index - Index of player in players array
     */
    const registerPlayer = (index) => {
      emit('register-player', index);
    };

    /**
     * Handles unregister button click
     * Emits event to parent with player index
     * 
     * @param {number} index - Index of player in players array
     */
    const unregisterPlayer = (index) => {
      emit('unregister-player', index);
    };

    return {
      registerPlayer,
      unregisterPlayer,
      capacityLastUpdated: props.capacityLastUpdated  // Expose prop to template
    };
  },
  template: `
    <div v-if="players.length > 0" class="result">
      <p class="success">Manage your registration:</p>
      <capacity-banner :capacity="capacity" :last-updated="capacityLastUpdated" />
      
      <div v-for="(player, index) in players" :key="player.bttc_id || index" class="entry">
        <div v-if="player.is_registered">
          <p style="color: gray;">
            {{ player.first_name }} {{ player.last_name }} 
            <span style="font-weight: bold;">(Already registered)</span>
          </p>
          <div class="unregister-form">
            <input 
              type="text" 
              :placeholder="'Enter your PIN'"
              class="token-field" 
              v-model="player.unregisterToken"
            />
            <button 
              type="button"
              style="background-color: #dc3545;" 
              class="confirm-btn" 
              @click="unregisterPlayer(index)"
            >
              Unregister
            </button>
            <span class="token-error" v-if="player.unregisterError">{{ player.unregisterError }}</span>
          </div>
        </div>
        <div v-else>
          <p v-if="capacity.isAtCapacity" style="color: #666;">
            {{ player.first_name }} {{ player.last_name }}
          </p>
          <p v-else>
            {{ player.first_name }} {{ player.last_name }}
          </p>
          
          <div v-if="capacity.isAtCapacity" class="register-form">
            <p class="registration-full-message">
              ❌ Registration is full ({{ capacity.confirmedCount }}/{{ capacity.playerCap }})
            </p>
          </div>
          <div v-else class="register-form">
            <input 
              type="text" 
              :placeholder="'Enter your PIN'"
              class="token-field" 
              v-model="player.registerToken"
            />
            <button 
              type="button"
              class="confirm-btn" 
              @click="registerPlayer(index)"
            >
              Register
            </button>
            <span class="token-error" v-if="player.registerError">{{ player.registerError }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
  components: {
    CapacityBanner
  }
};

// ========================================
// REGISTRATION DIALOG COMPONENT
// ========================================

/**
 * RegistrationDialog Component
 * 
 * PURPOSE: Modal confirmation dialog for Round Robin registration
 * 
 * PROPS:
 * - show: Boolean controlling dialog visibility
 * - player: Player object being registered
 * 
 * BEHAVIOR:
 * - Displays as overlay modal when show=true
 * - Collects payment method (cash or Zelle/Venmo) - required
 * - Collects optional comments
 * - On confirm: Emits 'confirm' event with payment method and comments
 * - On close/cancel: Emits 'close' event and clears form
 */
const RegistrationDialog = {
  props: {
    show: Boolean,    // Controls dialog visibility
    player: Object    // Player object being registered
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    // Form state
    const paymentMethod = ref('');  // 'cash' or 'zelle_venmo'
    const comments = ref('');         // Optional comments

    /**
     * Handles confirm button click
     * Validates that payment method is selected, then emits confirm event
     */
    const handleConfirm = () => {
      // Payment method is required
      if (!paymentMethod.value) {
        alert('Please select a payment method.');
        return;
      }

      // Emit confirm event with form data
      const data = {
        paymentMethod: paymentMethod.value,
        comments: comments.value
      };
      emit('confirm', data);
    };

    /**
     * Handles close/cancel button click
     * Clears form and emits close event
     */
    const handleClose = () => {
      paymentMethod.value = '';
      comments.value = '';
      emit('close');
    };

    return {
      paymentMethod,
      comments,
      handleConfirm,
      handleClose
    };
  },
  template: `
    <div v-if="show" class="dialog-overlay" @click="handleClose">
      <div class="dialog-box" @click.stop>
        <div class="dialog-title">Complete Registration</div>

        <div class="payment-options">
          <h4>Payment Method:</h4>
          <div class="radio-option">
            <input 
              type="radio" 
              id="payByCash" 
              name="paymentMethod" 
              value="cash"
              v-model="paymentMethod"
            />
            <label for="payByCash">Pay by Cash</label>
          </div>
          <div class="radio-option">
            <input 
              type="radio" 
              id="payByDigital" 
              name="paymentMethod" 
              value="zelle_venmo"
              v-model="paymentMethod"
            />
            <label for="payByDigital">Pay by Zelle/Venmo</label>
          </div>
        </div>

        <div class="comments-section">
          <h4>Comments (optional):</h4>
          <textarea 
            v-model="comments"
            placeholder="Enter any comments or special requests..."
          ></textarea>
        </div>

        <div class="dialog-buttons">
          <button type="button" class="dialog-btn dialog-btn-cancel" @click="handleClose">Cancel</button>
          <button type="button" class="dialog-btn dialog-btn-ok" @click.stop="handleConfirm">Register</button>
        </div>
      </div>
    </div>
  `
};

// ========================================
// UNREGISTRATION DIALOG COMPONENT
// ========================================

/**
 * UnregistrationDialog Component
 * 
 * PURPOSE: Modal confirmation dialog for unregistering from Round Robin
 * 
 * PROPS:
 * - show: Boolean controlling dialog visibility
 * - player: Player object being unregistered
 * 
 * BEHAVIOR:
 * - Displays as overlay modal when show=true
 * - Collects optional reason for unregistering
 * - On confirm: Emits 'confirm' event with comments
 * - On close/cancel: Emits 'close' event and clears form
 */
const UnregistrationDialog = {
  props: {
    show: Boolean,    // Controls dialog visibility
    player: Object    // Player object being unregistered
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    // Form state
    const comments = ref('');  // Optional reason for unregistering

    /**
     * Handles confirm button click
     * Emits confirm event with comments
     */
    const handleConfirm = () => {
      emit('confirm', {
        comments: comments.value
      });
    };

    /**
     * Handles close/cancel button click
     * Clears form and emits close event
     */
    const handleClose = () => {
      comments.value = '';
      emit('close');
    };

    return {
      comments,
      handleConfirm,
      handleClose
    };
  },
  template: `
    <div v-if="show" class="dialog-overlay" @click="handleClose">
      <div class="dialog-box" @click.stop>
        <div class="dialog-title">Confirm Unregistration</div>

        <div class="comments-section">
          <h4>Reason for unregistering (optional):</h4>
          <textarea 
            v-model="comments"
            placeholder="Please let us know why you're unregistering..."
          ></textarea>
        </div>

        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-cancel" @click="handleClose">Cancel</button>
          <button class="dialog-btn dialog-btn-ok" @click="handleConfirm">Unregister</button>
        </div>
      </div>
    </div>
  `
};

// ========================================
// MAIN REGISTRATION APP COMPONENT
// ========================================

/**
 * RegistrationApp Component
 * 
 * PURPOSE: Main application component that orchestrates the Round Robin registration flow
 * 
 * COMPONENT HIERARCHY:
 * RegistrationApp (this component)
 *   ├── RegistrationStatus (status banner at top)
 *   ├── PlayerLookup (phone input form)
 *   ├── PlayerList (players found, with register/unregister buttons)
 *   ├── RegistrationDialog (registration confirmation modal)
 *   └── UnregistrationDialog (unregistration confirmation modal)
 * 
 * APPLICATION FLOW:
 * 1. App initializes → Checks registration status (time-based)
 * 2. User enters phone → PlayerLookup emits 'player-found'
 * 3. Players displayed → PlayerList shows matches
 * 4. User clicks Register → Opens RegistrationDialog
 * 5. User confirms → POST to /rr/register API
 * 6. Success → Updates player list, refreshes capacity
 * 
 * REGISTRATION RULES (configurable via ENV):
 * - Opens: Configurable day/time (default: Wednesday at 00:00/midnight)
 * - Closes: Configurable day/time (default: Friday at 18:45/6:45 PM PST)
 * - Capacity check before allowing registration
 * - Configure via REGISTRATION_OPENING_DAY, REGISTRATION_OPENING_HOUR, REGISTRATION_OPENING_MINUTE
 * - Configure via REGISTRATION_CLOSING_DAY, REGISTRATION_CLOSING_HOUR, REGISTRATION_CLOSING_MINUTE
 * - DEV_OVERRIDE flag bypasses time restrictions (for testing)
 */
const RegistrationApp = {
  components: {
    RegistrationStatus,     // Status banner (open/closed)
    PlayerLookup,          // Phone input and lookup
    PlayerList,            // Player list with actions
    RegistrationDialog,    // Registration confirmation modal
    UnregistrationDialog   // Unregistration confirmation modal
  },
  setup() {
    // Load configuration constants from ENV (or use defaults)
    const devOverride = typeof ENV !== 'undefined' ? ENV.DEV_OVERRIDE : false;
    
    // Opening configuration (default: Wednesday at 00:00)
    const openingDay = typeof ENV !== 'undefined' ? ENV.REGISTRATION_OPENING_DAY : 3;  // Wednesday = 3
    const openingHour = typeof ENV !== 'undefined' ? ENV.REGISTRATION_OPENING_HOUR : 0;  // 00:00 (midnight)
    const openingMinute = typeof ENV !== 'undefined' ? ENV.REGISTRATION_OPENING_MINUTE : 0;
    
    // Closing configuration (default: Friday at 18:45)
    const closingDay = typeof ENV !== 'undefined' ? ENV.REGISTRATION_CLOSING_DAY : 5;  // Friday = 5
    const closingHour = typeof ENV !== 'undefined' ? ENV.REGISTRATION_CLOSING_HOUR : 18;  // 18:00 (6 PM)
    const closingMinute = typeof ENV !== 'undefined' ? ENV.REGISTRATION_CLOSING_MINUTE : 45;  // 45 minutes
    
    const timezone = typeof ENV !== 'undefined' ? ENV.TIMEZONE : 'America/Los_Angeles';
    const defaultPlayerCap = typeof ENV !== 'undefined' ? ENV.DEFAULT_PLAYER_CAP : 64;
    const fallbackPlayerCap = typeof ENV !== 'undefined' ? ENV.FALLBACK_PLAYER_CAP : 64;
    const supportPhone = typeof ENV !== 'undefined' ? ENV.SUPPORT_PHONE : '510-926-6913';
    const supportMethod = typeof ENV !== 'undefined' ? ENV.SUPPORT_METHOD : 'TEXT ONLY';
    
    // Application state
    const players = ref([]);                    // Players found by phone number
    const registrationOpen = ref(false);        // Whether registration is currently open
    const capacity = ref({
      isAtCapacity: false,                       // Whether event is at capacity
      confirmedCount: 0,                        // Number of confirmed registrations
      playerCap: fallbackPlayerCap,             // Maximum capacity
      spotsAvailable: 0                         // Available spots
    });
    const capacityLastUpdated = ref(null);       // Timestamp when capacity was last fetched
    const showRegistrationDialog = ref(false);    // Controls registration dialog visibility
    const showUnregistrationDialog = ref(false); // Controls unregistration dialog visibility
    const currentRegistrationData = ref(null);  // Player being registered (for dialog)
    const currentUnregistrationData = ref(null); // Player being unregistered (for dialog)
    const error = ref('');                      // Error message to display

    // Computed properties
    // Closing time: Shows closing day and time (default: Friday 6:45 PM)
    const closingTime = computed(() => {
      const now = new Date();
      const pstNow = new Date(now.toLocaleString("en-US", {timeZone: timezone}));
      const dayOfWeek = pstNow.getDay();
      
      // Calculate the current or next closing day
      let closingDate = new Date(pstNow);
      const daysUntilClosingDay = (closingDay - dayOfWeek + 7) % 7;
      
      // If it's the closing day but past closing time, use next week's closing day
      if (daysUntilClosingDay === 0 && (pstNow.getHours() > closingHour || (pstNow.getHours() === closingHour && pstNow.getMinutes() >= closingMinute))) {
        // Past closing time, use next week's closing day
        closingDate.setDate(closingDate.getDate() + 7);
      } else {
        closingDate.setDate(closingDate.getDate() + daysUntilClosingDay);
      }
      
      closingDate.setHours(closingHour, closingMinute, 0, 0);
      return closingDate.toLocaleString("en-US", {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit'
      });
    });

    // Next opening: Shows next opening day and time (default: Wednesday at 12:00 AM)
    const nextOpening = computed(() => {
      const now = new Date();
      const pstNow = new Date(now.toLocaleString("en-US", {timeZone: timezone}));
      const dayOfWeek = pstNow.getDay();
      const hours = pstNow.getHours();
      const minutes = pstNow.getMinutes();
      
      let daysUntilOpeningDay;
      
      // Check if we're currently on the opening day and past opening time
      const isPastOpeningTimeToday = (dayOfWeek === openingDay && 
        (hours > openingHour || (hours === openingHour && minutes >= openingMinute)));
      
      if (isPastOpeningTimeToday || dayOfWeek === openingDay) {
        // If it's the opening day (or past opening time on opening day), next opening is next week
        daysUntilOpeningDay = 7;
      } else if (dayOfWeek < openingDay) {
        // Before opening day in the week
        daysUntilOpeningDay = openingDay - dayOfWeek;
      } else {
        // After opening day but before next opening day
        daysUntilOpeningDay = 7 - (dayOfWeek - openingDay);
      }

      const nextOpeningDate = new Date(pstNow);
      nextOpeningDate.setDate(nextOpeningDate.getDate() + daysUntilOpeningDay);
      nextOpeningDate.setHours(openingHour, openingMinute, 0, 0);

      return nextOpeningDate.toLocaleString("en-US", {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    });

    // Methods
    /**
     * Checks if registration is currently open
     * 
     * REGISTRATION SCHEDULE (configurable via ENV):
     * - Opens: Configurable day/time (default: Wednesday at 00:00)
     * - Closes: Configurable day/time (default: Friday at 18:45)
     * 
     * LOGIC:
     * - If current day is after opening day but before closing day → OPEN
     * - If current day is opening day and past opening time → OPEN
     * - If current day is closing day and before closing time → OPEN
     * - Otherwise → CLOSED
     */
    const isRegistrationOpen = () => {
      if (devOverride) return true;

      const now = new Date();
      const pstNow = new Date(now.toLocaleString("en-US", {timeZone: timezone}));
      const dayOfWeek = pstNow.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
      const hours = pstNow.getHours();
      const minutes = pstNow.getMinutes();

      // Check if we're on the opening day
      if (dayOfWeek === openingDay) {
        // Opening day: check if we're past opening time
        if (hours > openingHour || (hours === openingHour && minutes >= openingMinute)) {
          // Past opening time on opening day → OPEN
          return true;
        }
        // Before opening time on opening day → CLOSED
        return false;
      }
      
      // Check if we're on the closing day
      if (dayOfWeek === closingDay) {
        // Closing day: check if we're before closing time
        if (hours < closingHour || (hours === closingHour && minutes < closingMinute)) {
          // Before closing time on closing day → OPEN
          return true;
        }
        // At or after closing time on closing day → CLOSED
        return false;
      }
      
      // Check if we're between opening day and closing day
      // Handle week wrap-around (e.g., opening on Wednesday, closing on Friday)
      let isBetweenDays;
      if (openingDay < closingDay) {
        // Opening and closing are in the same week (e.g., Wed to Fri)
        isBetweenDays = dayOfWeek > openingDay && dayOfWeek < closingDay;
      } else {
        // Opening and closing wrap around the week (e.g., Fri to Wed)
        isBetweenDays = dayOfWeek > openingDay || dayOfWeek < closingDay;
      }
      
      if (isBetweenDays) {
        // We're between opening and closing days → OPEN
        return true;
      }
      
      // Otherwise, we're outside the registration window → CLOSED
      return false;
    };

    const checkRegistrationStatus = () => {
      registrationOpen.value = isRegistrationOpen();
    };

    // NOTE: Capacity is now included in all API responses (search, register, unregister)
    // No need for separate /rr/capacity calls anymore

    const handlePlayerFound = (data) => {
      // New API response structure: { players: [], capacity: {} }
      const playerList = Array.isArray(data) ? data : (data.players || []);
      
      if (data.result === "None" || playerList.length === 0) {
        error.value = 'No player found for this phone number.';
        players.value = [];
        return;
      }

      error.value = '';
      players.value = playerList.map(player => ({
        ...player,
        registerToken: '',
        unregisterToken: '',
        registerError: '',
        unregisterError: ''
      }));
      
      // Extract capacity from search response (new API always includes capacity)
      if (data.capacity) {
        const capacityData = {
          isAtCapacity: !!data.capacity.roster_full,
          confirmedCount: Number(data.capacity.confirmed_count || 0),
          playerCap: Number(data.capacity.player_cap || defaultPlayerCap),
          spotsAvailable: Number(data.capacity.spots_available || 0),
          eventOpen: !!data.capacity.event_open
        };
        
        const now = Date.now();
        capacity.value = capacityData;
        capacityLastUpdated.value = now;
        
        // Clear any previous capacity errors on success
        if (error.value && error.value.includes('capacity')) {
          error.value = '';
        }
      } else {
        // If capacity not included (should not happen with new API), show error
        error.value = 'Capacity information is missing from the response. Please refresh and try again.';
      }
    };

    const handleLookupError = (errorMessage) => {
      error.value = errorMessage;
      players.value = [];
    };

    /**
     * Validates PIN/token format
     * Must be exactly 6 digits (numbers only)
     * 
     * @param {string} token - PIN to validate
     * @returns {object} - { valid: boolean, message?: string }
     */
    const validateToken = (token) => {
      if (!token || token.trim() === '') {
        return { valid: false, message: 'Please enter your PIN.' };
      }
      
      const trimmedToken = token.trim();
      const tokenRegex = /^\d{6}$/;
      
      if (!tokenRegex.test(trimmedToken)) {
        return { valid: false, message: 'PIN must be exactly 6 digits.' };
      }
      
      return { valid: true };
    };

    const handleRegisterPlayer = (index) => {
      if (!registrationOpen.value) {
        alert('Registration is currently closed.');
        return;
      }

      if (capacity.value.isAtCapacity) {
        alert(`Registration is full! All ${capacity.value.playerCap} spots have been taken.`);
        return;
      }

      const player = players.value[index];
      
      // Validate PIN before making API call
      const tokenValidation = validateToken(player.registerToken);
      if (!tokenValidation.valid) {
        player.registerError = tokenValidation.message;
        return;
      }
      
      // Clear any previous errors
      player.registerError = '';

      currentRegistrationData.value = { player, index };
      showRegistrationDialog.value = true;
    };

    const handleUnregisterPlayer = (index) => {
      const player = players.value[index];
      
      // Validate PIN before making API call
      const tokenValidation = validateToken(player.unregisterToken);
      if (!tokenValidation.valid) {
        player.unregisterError = tokenValidation.message;
        return;
      }
      
      // Clear any previous errors
      player.unregisterError = '';

      currentUnregistrationData.value = { player, index };
      showUnregistrationDialog.value = true;
    };

    const confirmRegistration = async (data) => {
      if (!currentRegistrationData.value) {
        alert('Error: No player data found. Please try looking up your player again.');
        showRegistrationDialog.value = false;
        return;
      }
      
      const { player, index } = currentRegistrationData.value;
      
      try {
        // Validate token again before API call (extra safety check)
        const tokenValidation = validateToken(player.registerToken);
        if (!tokenValidation.valid) {
          players.value[index].registerError = tokenValidation.message;
          showRegistrationDialog.value = false;
          return;
        }
        
        const payload = {
          bttc_id: player.bttc_id,
          first_name: player.first_name,
          last_name: player.last_name,
          token: player.registerToken.trim(), // Trim token before sending
          payment_method: data.paymentMethod,
          comments: data.comments
        };

        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const url = `${apiUrl}/rr/register`;
        
        const fetchOptions = getFetchOptions({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        
        const response = await fetch(url, fetchOptions);
        const result = await handleApiResponse(response);
        
        if (result.success) {
          alert(result.message);
          showRegistrationDialog.value = false;
          
          // Update local state instead of clearing and forcing a new lookup
          // Mark the player as registered in the local players array
          if (players.value[index]) {
            players.value[index].is_registered = true;
            // Clear any PIN/token fields
            players.value[index].registerToken = '';
            players.value[index].unregisterToken = '';
            players.value[index].registerError = '';
            players.value[index].unregisterError = '';
          }
          
          // Extract capacity from registration response (new API always includes capacity)
          if (result.capacity) {
            const capacityData = {
              isAtCapacity: !!result.capacity.roster_full,
              confirmedCount: Number(result.capacity.confirmed_count || 0),
              playerCap: Number(result.capacity.player_cap || defaultPlayerCap),
              spotsAvailable: Number(result.capacity.spots_available || 0),
              eventOpen: !!result.capacity.event_open
            };
            
            const now = Date.now();
            capacity.value = capacityData;
            capacityLastUpdated.value = now;
            
            // Clear any previous capacity errors on success
            if (error.value && error.value.includes('capacity')) {
              error.value = '';
            }
          } else {
            // If capacity not included (should not happen with new API), continue without capacity
          }
          
          error.value = '';
        } else {
          if (result.isAtCapacity) {
            alert(`Registration is full! All ${result.playerCap} spots have been taken.`);
          } else {
            players.value[index].registerError = result.message;
          }
          showRegistrationDialog.value = false;
        }
      } catch (err) {
        const friendlyMessage = getErrorMessage(err, 'registration');
        players.value[index].registerError = friendlyMessage;
        showRegistrationDialog.value = false;
      }
    };

    const confirmUnregistration = async (data) => {
      const { player, index } = currentUnregistrationData.value;
      
      try {
        // Validate token again before API call (extra safety check)
        const tokenValidation = validateToken(player.unregisterToken);
        if (!tokenValidation.valid) {
          players.value[index].unregisterError = tokenValidation.message;
          showUnregistrationDialog.value = false;
          return;
        }
        
        const payload = {
          bttc_id: player.bttc_id,
          first_name: player.first_name,
          last_name: player.last_name,
          token: player.unregisterToken.trim(), // Trim token before sending
          comments: data.comments
        };

        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const fetchOptions = getFetchOptions({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const response = await fetch(`${apiUrl}/rr/unregister`, fetchOptions);

        const result = await handleApiResponse(response);
        
        if (result.success) {
          alert(result.message);
          showUnregistrationDialog.value = false;
          
          // Update local state instead of making another API call
          // Mark the player as unregistered in the local players array
          if (players.value[index]) {
            players.value[index].is_registered = false;
            // Clear any PIN/token fields
            players.value[index].unregisterToken = '';
            players.value[index].registerToken = '';
            players.value[index].registerError = '';
            players.value[index].unregisterError = '';
          }
          
          // Extract capacity from unregistration response (new API always includes capacity)
          if (result.capacity) {
            const capacityData = {
              isAtCapacity: !!result.capacity.roster_full,
              confirmedCount: Number(result.capacity.confirmed_count || 0),
              playerCap: Number(result.capacity.player_cap || defaultPlayerCap),
              spotsAvailable: Number(result.capacity.spots_available || 0),
              eventOpen: !!result.capacity.event_open
            };
            
            const now = Date.now();
            capacity.value = capacityData;
            capacityLastUpdated.value = now;
            
            // Clear any previous capacity errors on success
            if (error.value && error.value.includes('capacity')) {
              error.value = '';
            }
          } else {
            // If capacity not included (should not happen with new API), continue without capacity
          }
        } else {
          players.value[index].unregisterError = result.message;
          showUnregistrationDialog.value = false;
        }
      } catch (err) {
        const friendlyMessage = getErrorMessage(err, 'unregistration');
        players.value[index].unregisterError = friendlyMessage;
        showUnregistrationDialog.value = false;
      }
    };

    // Lifecycle
    onMounted(() => {
      checkRegistrationStatus();
    });

    return {
      players,
      registrationOpen,
      capacity,
      capacityLastUpdated,
      showRegistrationDialog,
      showUnregistrationDialog,
      currentRegistrationData,
      currentUnregistrationData,
      error,
      devOverride,
      closingTime,
      nextOpening,
      handlePlayerFound,
      handleLookupError,
      handleRegisterPlayer,
      handleUnregisterPlayer,
      confirmRegistration,
      confirmUnregistration,
      supportPhone,
      supportMethod
    };
  },
  template: `
    <div class="container">
      <div class="roster-section">
        <a href="bttc_roster_vue.html" class="roster-link-button">
          <span class="roster-text">View Players Registered for Round Robin</span>
          <span class="roster-subtext">See current RR registrations</span>
        </a>
      </div>

      <h2 style="font-family: Arial, sans-serif; font-weight: bold;">Round Robin Registration</h2>

      <registration-status 
        :is-open="registrationOpen"
        :closing-time="closingTime"
        :next-opening="nextOpening"
        :dev-mode="devOverride"
      />

      <player-lookup 
        v-if="registrationOpen"
        :registration-open="registrationOpen"
        @player-found="handlePlayerFound"
        @lookup-error="handleLookupError"
      />

      <div v-if="registrationOpen && error" class="error-section">
        <div class="error-content">
          <h3 class="error-title">Player Not Found</h3>
          
          <div class="error-actions">
            <a href="bttc_player_signup_vue.html" class="signup-button">
              <span class="signup-button-text">Sign Up as New Player</span>
              <span class="signup-button-subtext">Create your player account</span>
            </a>
          </div>
          
          <div class="error-support">
            <p class="support-text">Need help? Contact BTTC support:</p>
            <p class="support-contact">{{ supportPhone }} <span class="support-method">({{ supportMethod }})</span></p>
          </div>
        </div>
      </div>

      <player-list 
        v-if="registrationOpen && (!error || !error.includes('capacity'))"
        :players="players"
        :capacity="capacity"
        :capacity-last-updated="capacityLastUpdated"
        @register-player="handleRegisterPlayer"
        @unregister-player="handleUnregisterPlayer"
      />

      <div v-if="registrationOpen && players.length > 0 && (!error || !error.includes('capacity'))" class="signup-section">
        <a href="bttc_player_signup_vue.html" class="signup-button">
          <span class="signup-button-text">Sign Up Another Player</span>
          <span class="signup-button-subtext">Create another player account associated with this phone number</span>
        </a>
      </div>

      <registration-dialog 
        :show="showRegistrationDialog"
        :player="currentRegistrationData?.player"
        @close="showRegistrationDialog = false"
        @confirm="confirmRegistration"
      />

      <unregistration-dialog 
        :show="showUnregistrationDialog"
        :player="currentUnregistrationData?.player"
        @close="showUnregistrationDialog = false"
        @confirm="confirmUnregistration"
      />
    </div>
  `
};

// ========================================
// CREATE VUE APP
// ========================================
const app = createApp({
  components: {
    RegistrationApp
  },
  errorHandler: (err, instance, info) => {
    // Handle Vue component errors gracefully
    // Don't show Vue internal errors to users - they're already handled in components
  }
});

// Mount the app
app.mount('#vue-registration-app');

// Handle unhandled promise rejections (network errors, etc.)
window.addEventListener('unhandledrejection', (event) => {
  // If it's a network error, we've already handled it in our try-catch blocks
  // But this catches any edge cases
  const error = event.reason;
  if (error && (error instanceof TypeError || error?.message?.includes('fetch'))) {
    // This is likely already handled by our error handlers, so we can prevent default
    event.preventDefault();
  }
});
