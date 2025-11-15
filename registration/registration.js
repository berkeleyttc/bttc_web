// BTTC Round Robin Registration
// Utilities loaded from bttc-utils.js: getErrorMessage, getFetchOptions, handleApiResponse, validatePhone, validateToken, formatPhoneNumber

const { createApp, ref, reactive, computed, onMounted, nextTick, watch } = Vue;


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

const CapacityBanner = {
  props: {
    capacity: Object,
    lastUpdated: Number  // Timestamp in milliseconds, optional
  },
  methods: {
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
      // Event closed takes highest priority
      if (!this.capacity.eventOpen) {
        return 'capacity-closed';
      }
      return this.capacity.isAtCapacity ? 'capacity-full' : 'capacity-available';
    },
    lastUpdatedText() {
      return this.formatLastUpdated(this.lastUpdated);
    }
  },
  template: `
    <div class="capacity-banner" :class="capacityClass">
      <div v-if="!capacity.eventOpen">
        🔴 Event registrations are CLOSED
      </div>
      <div v-else-if="capacity.isAtCapacity">
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

const PHONE_HISTORY_KEY = 'bttc_phone_history';
const MAX_HISTORY_ITEMS = 10;
const EVENT_METADATA_CACHE_KEY = 'bttc_event_metadata';
const EVENT_METADATA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (event date never changes)
const ROSTER_CACHE_KEY = 'bttc_roster_cache'; // Same cache key as roster-vue.js

const getPhoneHistory = () => {
  try {
    const history = localStorage.getItem(PHONE_HISTORY_KEY);
    return history ? JSON.parse(history) : [];
  } catch (err) {
    // localStorage unavailable or corrupted JSON, return empty array
    return [];
  }
};

// Cache for event metadata (event_date, event_type)
const getEventMetadataCache = () => {
  try {
    const cached = sessionStorage.getItem(EVENT_METADATA_CACHE_KEY);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    const now = Date.now();
    const age = now - timestamp;
    
    // Check if cache is still valid (24 hours TTL)
    if (age < EVENT_METADATA_CACHE_TTL) {
      return data;
    }
    
    // Cache expired, remove it
    sessionStorage.removeItem(EVENT_METADATA_CACHE_KEY);
    return null;
  } catch (err) {
    return null;
  }
};

const setEventMetadataCache = (eventDate, eventType) => {
  try {
    const cacheEntry = {
      data: { eventDate, eventType },
      timestamp: Date.now()
    };
    sessionStorage.setItem(EVENT_METADATA_CACHE_KEY, JSON.stringify(cacheEntry));
  } catch (err) {
    // sessionStorage unavailable, silently fail
  }
};

// Cache roster data (shared with roster-vue.js)
const setRosterCache = (rosterData, capacityData) => {
  try {
    const cacheEntry = {
      data: {
        roster: rosterData,
        capacity: capacityData
      },
      timestamp: Date.now()
    };
    sessionStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify(cacheEntry));
  } catch (err) {
    // sessionStorage unavailable, silently fail
  }
};

const savePhoneToHistory = (phone) => {
  try {
    // Format phone for display in history using shared utility (xxx-xxx-xxxx)
    const cleaned = phone.replace(/\D/g, '');
    const formatted = formatPhoneNumber(cleaned);
    
    const history = getPhoneHistory();
    // Remove if already exists (to move to top on next lookup)
    const filtered = history.filter(p => p.replace(/\D/g, '') !== cleaned);
    // Add to beginning (most recent first)
    filtered.unshift(formatted);
    // Keep only max items (remove oldest entries)
    const trimmed = filtered.slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(PHONE_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // Silent fail - if localStorage is unavailable, just continue without saving history
  }
};

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
    const collapsed = ref(false);     // Whether the search form is minimized/collapsed

    const filterPhoneInput = (e) => {
      // Get current value and remove any non-numeric characters, then format
      const numericOnly = e.target.value.replace(/\D/g, '');
      phoneInput.value = formatPhoneNumber(numericOnly);
    };

    const handleSubmit = async (e) => {
      e.preventDefault();
      
      // Prevent lookup if registration is closed
      if (!props.registrationOpen) {
        alert('Registration is currently closed. Please check the status banner above for when it will reopen.');
        return;
      }

      // Strip dashes before validation (user sees formatted, backend gets clean digits)
      const cleanedInput = phoneInput.value.replace(/\D/g, '');
      
      const validation = validatePhone(cleanedInput);
      if (!validation.valid) {
        phoneError.value = validation.message;
        emit('lookup-error', validation.message);
        return;
      }
      
      // Clear previous errors
      phoneError.value = '';
      const phone = validation.phone;  // Use cleaned phone number (digits only)

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
        
        // Collapse the search form after successful lookup (whether players found or not)
        // This enables "Search Again" functionality for both success and "not found" cases
        collapsed.value = true;
        
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

    const toggleCollapse = () => {
      collapsed.value = !collapsed.value;
      // Clear errors when expanding to provide a fresh start
      if (!collapsed.value) {
        phoneError.value = '';
      }
    };

    onMounted(() => {
      phoneHistory.value = getPhoneHistory();
    });

    return {
      phoneInput,
      isLookingUp,
      phoneError,
      phoneHistory,
      collapsed,
      filterPhoneInput,
      handleSubmit,
      toggleCollapse
    };
  },
  template: `
    <div class="registration-content" :class="{ 'lookup-collapsed': collapsed }">
      <!-- Collapsed state: Just show a simple link -->
      <div v-if="collapsed" class="lookup-collapsed-link">
        <a 
          href="#"
          class="lookup-toggle-link"
          @click.prevent="toggleCollapse"
          aria-label="Expand search form"
        >
          🔍 Search Again
        </a>
      </div>
      
      <!-- Expanded state: Show full form -->
      <div v-show="!collapsed" class="lookup-expanded-container">
        <div class="lookup-header">
          <h3 class="lookup-title">Sign in (Returning Players)</h3>
        </div>
        <div class="lookup-form-container">
          <form @submit="handleSubmit" class="lookup-form">
            <div class="input-wrapper">
              <label for="phone-lookup" class="input-label">Phone Number</label>
              <div class="input-container" :class="{ 'input-error': phoneError }">
                <span class="input-prefix">+1</span>
                <input 
                  id="phone-lookup"
                  v-model="phoneInput"
                  type="tel" 
                  maxlength="12" 
                  placeholder="xxx-xxx-xxxx" 
                  class="phone-input"
                  :class="{ 'input-loading': isLookingUp, 'input-error': phoneError }"
                  inputmode="numeric"
                  pattern="[0-9-]*"
                  list="phone-history-list"
                  autocomplete="tel"
                  required 
                  :disabled="isLookingUp"
                  @input="filterPhoneInput"
                />
                <datalist id="phone-history-list">
                  <option v-for="phone in phoneHistory" :key="phone" :value="phone">
                    {{ phone }}
                  </option>
                </datalist>
                <span v-if="isLookingUp" class="input-spinner"></span>
              </div>
              <p v-if="phoneError" class="input-error-text">{{ phoneError }}</p>
              <p v-else class="input-hint">Enter your 10-digit US phone number</p>
            </div>
            <button 
              type="submit" 
              class="lookup-button"
              :class="{ 'button-loading': isLookingUp }"
              :disabled="isLookingUp"
            >
              <span v-if="!isLookingUp" class="button-text">
                Sign in
              </span>
              <span v-else class="button-text">
                <span class="button-spinner"></span>
                Looking up...
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  `
};

const PlayerList = {
  props: {
    players: Array,        // Array of player objects from search
    capacity: Object,      // Capacity info: { isAtCapacity, confirmedCount, playerCap, spotsAvailable }
    capacityLastUpdated: Number  // Timestamp when capacity was last fetched (optional)
  },
  emits: ['register-player', 'unregister-player'],
  setup(props, { emit }) {
    const registerPlayer = (index) => {
      emit('register-player', index);
    };

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
      <div class="result-header">
        <p class="success">Players Found</p>
        <p class="result-subtitle">Select an action below for each player</p>
      </div>
      <capacity-banner :capacity="capacity" :last-updated="capacityLastUpdated" />
      
      <div v-for="(player, index) in players" :key="player.bttc_id || index" class="entry">
        <div class="entry-header">
          <h4 class="player-name-heading">{{ player.first_name }} {{ player.last_name }}</h4>
        </div>
        
        <div v-if="player.is_registered" class="entry-content">
          <p class="player-registered-status">
            <span class="status-icon">✓</span>
            <span class="player-registered-label">Already registered</span>
          </p>
          <div v-if="!capacity.eventOpen" class="unregister-form">
            <p class="registration-full-message">
              <span class="status-icon">🔒</span>
              Event registrations are currently closed
            </p>
            <p class="full-message-hint">You cannot unregister at this time. Please contact BTTC support if needed.</p>
          </div>
          <div v-else class="unregister-form">
            <button 
              type="button"
              class="confirm-btn unregister-btn" 
              @click="unregisterPlayer(index)"
            >
              Unregister
            </button>
            <span class="token-error" v-if="player.unregisterError">{{ player.unregisterError }}</span>
          </div>
        </div>
        <div v-else class="entry-content">
          <div v-if="!capacity.eventOpen" class="register-form full-message">
            <p class="registration-full-message">
              <span class="status-icon">🔒</span>
              Event registrations are currently closed
            </p>
            <p class="full-message-hint">Please check back later or contact BTTC support for more information.</p>
          </div>
          <div v-else-if="capacity.isAtCapacity" class="register-form full-message">
            <p class="registration-full-message">
              <span class="status-icon">❌</span>
              Registration is full ({{ capacity.confirmedCount }}/{{ capacity.playerCap }})
            </p>
            <p class="full-message-hint">Please check back later or contact BTTC support if you believe this is an error.</p>
          </div>
          <div v-else class="register-form">
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

const RegistrationDialog = {
  props: {
    show: Boolean,    // Controls dialog visibility
    player: Object,   // Player object being registered
    successMessage: String,  // Success message to display inline
    errorMessage: String     // Error message to display inline
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    // Waiver configuration - update filename here when waiver version changes
    const WAIVER_FILE = '../liability_waiver_2025-11-03-v1.html';
    
    // Form state
    const paymentMethod = ref('');  // 'cash' or 'zelle_venmo'
    const comments = ref('');         // Optional comments
    const waiverAccepted = ref(false); // Waiver acceptance checkbox
    const validationError = ref('');  // Inline validation errors

    const handleConfirm = () => {
      // Clear previous validation errors
      validationError.value = '';

      // Payment method is required
      if (!paymentMethod.value) {
        validationError.value = 'Please select a payment method.';
        return;
      }

      // Waiver acceptance is required
      if (!waiverAccepted.value) {
        validationError.value = 'You must accept the liability waiver to register.';
        return;
      }

      // Prepend waiver acceptance to comments
      const waiverNote = `Waiver accepted: ${WAIVER_FILE}`;
      const fullComments = comments.value 
        ? `${waiverNote}. ${comments.value}`
        : waiverNote;

      // Emit confirm event with form data
      const data = {
        paymentMethod: paymentMethod.value,
        comments: fullComments
      };
      emit('confirm', data);
    };

    const handleClose = () => {
      paymentMethod.value = '';
      comments.value = '';
      waiverAccepted.value = false;
      validationError.value = '';
      emit('close');
    };

    // Watch for dialog opening and reset all form fields
    watch(() => props.show, (newValue) => {
      if (newValue) {
        // Reset all form fields when dialog opens
        paymentMethod.value = '';
        comments.value = '';
        waiverAccepted.value = false;
        validationError.value = '';
      }
    });

    return {
      paymentMethod,
      comments,
      waiverAccepted,
      validationError,
      WAIVER_FILE,
      handleConfirm,
      handleClose
    };
  },
  template: `
    <div v-if="show" class="dialog-overlay" @click="handleClose">
      <div class="dialog-box" @click.stop>
        <div class="dialog-title">Complete Registration</div>

        <!-- Success Message -->
        <div v-if="successMessage" class="dialog-message dialog-message-success">
          <span class="message-icon">✓</span>
          <div class="message-text">
            <div>{{ successMessage }}</div>
            <div class="success-next-steps">
              Please confirm your name appears in the "Round Robin Registered Players" list.
            </div>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="errorMessage" class="dialog-message dialog-message-error">
          <span class="message-icon">✗</span>
          <span class="message-text">{{ errorMessage }}</span>
        </div>

        <!-- Validation Error -->
        <div v-if="validationError" class="dialog-message dialog-message-error">
          <span class="message-icon">⚠</span>
          <span class="message-text">{{ validationError }}</span>
        </div>

        <!-- Show form only if no success message -->
        <div v-if="!successMessage">
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
              <label for="payByDigital">Pay by Zelle/Venmo (recommended)</label>
            </div>
          </div>

          <div class="comments-section">
            <h4>Comments (optional):</h4>
            <textarea 
              v-model="comments"
              placeholder="Enter any comments or special requests..."
            ></textarea>
          </div>

          <div class="waiver-section">
            <div class="waiver-checkbox">
              <input 
                type="checkbox" 
                id="waiverAccept" 
                v-model="waiverAccepted"
              />
              <label for="waiverAccept">
                I have read and agree to the 
                <a :href="WAIVER_FILE" target="_blank" rel="noopener noreferrer" @click.stop>liability waiver</a>
              </label>
            </div>
            <p class="waiver-note">* Required. If you are a minor, please have your parent/guardian review this.</p>
          </div>
        </div>

        <div class="dialog-buttons">
          <button v-if="!successMessage" type="button" class="dialog-btn dialog-btn-cancel" @click="handleClose">Cancel</button>
          <button 
            v-if="!successMessage"
            type="button" 
            class="dialog-btn dialog-btn-ok" 
            :disabled="!waiverAccepted"
            :class="{ 'dialog-btn-disabled': !waiverAccepted }"
            @click.stop="handleConfirm"
          >
            Register
          </button>
          <button v-if="successMessage" type="button" class="dialog-btn dialog-btn-ok" @click="handleClose">Close</button>
        </div>
      </div>
    </div>
  `
};

const UnregistrationDialog = {
  props: {
    show: Boolean,    // Controls dialog visibility
    player: Object,   // Player object being unregistered
    successMessage: String,  // Success message to display inline
    errorMessage: String     // Error message to display inline
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    // Form state
    const comments = ref('');  // Optional reason for unregistering

    const handleConfirm = () => {
      emit('confirm', {
        comments: comments.value
      });
    };

    const handleClose = () => {
      comments.value = '';
      emit('close');
    };

    // Watch for dialog opening and reset form fields
    watch(() => props.show, (newValue) => {
      if (newValue) {
        comments.value = '';
      }
    });

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

        <!-- Success Message -->
        <div v-if="successMessage" class="dialog-message dialog-message-success">
          <span class="message-icon">✓</span>
          <span class="message-text">{{ successMessage }}</span>
        </div>

        <!-- Error Message -->
        <div v-if="errorMessage" class="dialog-message dialog-message-error">
          <span class="message-icon">✗</span>
          <span class="message-text">{{ errorMessage }}</span>
        </div>

        <!-- Show form only if no success message -->
        <div v-if="!successMessage">
          <div class="comments-section">
            <h4>Reason for unregistering (optional):</h4>
            <textarea 
              v-model="comments"
              placeholder="Please let us know why you're unregistering..."
            ></textarea>
          </div>
        </div>

        <div class="dialog-buttons">
          <button v-if="!successMessage" class="dialog-btn dialog-btn-cancel" @click="handleClose">Cancel</button>
          <button v-if="!successMessage" class="dialog-btn dialog-btn-ok" @click="handleConfirm">Unregister</button>
          <button v-if="successMessage" type="button" class="dialog-btn dialog-btn-ok" @click="handleClose">Close</button>
        </div>
      </div>
    </div>
  `
};

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
    const devOverride = typeof ENV !== 'undefined' ? (ENV.DEV_OVERRIDE ?? false) : false;
    console.log('DEV_OVERRIDE mode:', devOverride ? 'ENABLED' : 'DISABLED');
    
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
      spotsAvailable: 0,                        // Available spots
      eventOpen: true,                          // Whether event is accepting registrations
      eventDate: null,                          // Event date (ISO format YYYY-MM-DD)
      eventType: null                           // Event type (e.g., "rr", "tournament", "group_training")
    });
    const capacityLastUpdated = ref(null);       // Timestamp when capacity was last fetched
    const showRegistrationDialog = ref(false);    // Controls registration dialog visibility
    const showUnregistrationDialog = ref(false); // Controls unregistration dialog visibility
    const currentRegistrationData = ref(null);  // Player being registered (for dialog)
    const currentUnregistrationData = ref(null); // Player being unregistered (for dialog)
    const registrationSuccessMessage = ref('');  // Success message for registration dialog
    const registrationErrorMessage = ref('');    // Error message for registration dialog
    const unregistrationSuccessMessage = ref(''); // Success message for unregistration dialog
    const unregistrationErrorMessage = ref('');   // Error message for unregistration dialog
    const error = ref('');                      // Error message to display

    // Computed properties
    
    /**
     * Computed: Formatted event date in user-friendly format
     * Converts ISO date (YYYY-MM-DD) to "Month Day, Year" format (e.g., "Nov 2, 2025")
     * Returns empty string if no event date available
     */
    const formattedEventDate = computed(() => {
      if (!capacity.value.eventDate) return '';
      
      try {
        const date = new Date(capacity.value.eventDate + 'T00:00:00'); // Add time to avoid timezone issues
        
        // Check if date is valid
        if (isNaN(date.getTime())) {
          return '';
        }
        
        // Format date as "Month Day, Year" (e.g., "Nov 2, 2025")
        const formatted = date.toLocaleDateString("en-US", {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        
        return formatted;
      } catch (err) {
        return '';
      }
    });
    
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

    /**
     * Helper function to update capacity state from API response
     * Also caches event metadata (event_date, event_type) for future use
     */
    const updateCapacityFromResponse = (capacityData) => {
      if (!capacityData) return;
      
      const updatedCapacity = {
        isAtCapacity: !!capacityData.roster_full,
        confirmedCount: Number(capacityData.confirmed_count || 0),
        playerCap: Number(capacityData.player_cap || defaultPlayerCap),
        spotsAvailable: Number(capacityData.spots_available || 0),
        eventOpen: !!capacityData.event_open,
        eventDate: capacityData.event_date || null,
        eventType: capacityData.event_type || null
      };
      
      capacity.value = updatedCapacity;
      capacityLastUpdated.value = Date.now();
      
      // Cache event metadata separately (long TTL since event date never changes)
      if (capacityData.event_date || capacityData.event_type) {
        setEventMetadataCache(capacityData.event_date, capacityData.event_type);
      }
      
      // Clear any previous capacity errors on success
      if (error.value && error.value.includes('capacity')) {
        error.value = '';
      }
    };

    /**
     * Fetches event metadata (event_date, event_type) from cache or API
     * Called on mount to display event date without waiting for user action
     * Uses the capacity endpoint for lightweight fetch (no roster data needed)
     */
    const fetchEventMetadata = async () => {
      // Check cache first
      const cached = getEventMetadataCache();
      if (cached) {
        capacity.value.eventDate = cached.eventDate;
        capacity.value.eventType = cached.eventType;
        return;
      }
      
      // Not cached, fetch from API (use capacity endpoint - lightweight, just event metadata)
      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const url = `${apiUrl}/rr/capacity`;
        
        const fetchOptions = getFetchOptions({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const response = await fetch(url, fetchOptions);
        const data = await handleApiResponse(response);
        
        // Capacity endpoint returns capacity data directly
        if (data) {
          updateCapacityFromResponse(data);
        }
      } catch (err) {
        // Silently fail - event date is nice-to-have, not critical
        // User will see it after performing a lookup
      }
    };

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
        registerError: '',
        unregisterError: ''
      }));
      
      // Extract capacity from search response (new API always includes capacity)
      if (data.capacity) {
        updateCapacityFromResponse(data.capacity);
      } else {
        // If capacity not included (should not happen with new API), show error
        error.value = 'Capacity information is missing from the response. Please refresh and try again.';
      }
    };

    const handleLookupError = (errorMessage) => {
      error.value = errorMessage;
      players.value = [];
    };


    const handleRegisterPlayer = (index) => {
      if (!registrationOpen.value) {
        alert('Registration is currently closed.');
        return;
      }

      if (!capacity.value.eventOpen) {
        alert('This event is not currently accepting registrations. Please check back later or contact support.');
        return;
      }

      if (capacity.value.isAtCapacity) {
        alert(`Registration is full! All ${capacity.value.playerCap} spots have been taken.`);
        return;
      }

      const player = players.value[index];
      
      // Clear any previous errors
      player.registerError = '';

      // Clear dialog messages from previous interactions
      registrationSuccessMessage.value = '';
      registrationErrorMessage.value = '';

      currentRegistrationData.value = { player, index };
      showRegistrationDialog.value = true;
    };

    const handleUnregisterPlayer = (index) => {
      if (!capacity.value.eventOpen) {
        alert('This event is not currently accepting changes. Please check back later or contact support.');
        return;
      }

      const player = players.value[index];
      
      // Clear any previous errors
      player.unregisterError = '';

      // Clear dialog messages from previous interactions
      unregistrationSuccessMessage.value = '';
      unregistrationErrorMessage.value = '';

      currentUnregistrationData.value = { player, index };
      showUnregistrationDialog.value = true;
    };

    const confirmRegistration = async (data) => {
      if (!currentRegistrationData.value) {
        registrationErrorMessage.value = 'Error: No player data found. Please close this dialog and try looking up your player again.';
        return;
      }
      
      const { player, index } = currentRegistrationData.value;
      
      // Clear any previous messages
      registrationSuccessMessage.value = '';
      registrationErrorMessage.value = '';
      
      try {
        const payload = {
          bttc_id: player.bttc_id,
          first_name: player.first_name,
          last_name: player.last_name,
          payment_method: data.paymentMethod,
          comments: data.comments  // Comments now include waiver version
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
          // Set success message instead of alert
          registrationSuccessMessage.value = result.message || 'Registration completed successfully!';
          
          // Update local state instead of clearing and forcing a new lookup
          // Mark the player as registered in the local players array
          if (players.value[index]) {
            players.value[index].is_registered = true;
            // Clear any error fields
            players.value[index].registerError = '';
            players.value[index].unregisterError = '';
          }
          
          // Extract capacity from registration response (new API always includes capacity)
          if (result.capacity) {
            updateCapacityFromResponse(result.capacity);
          }
          
          error.value = '';
          // Don't close the dialog - let user see success message and click Close button
        } else {
          if (result.isAtCapacity) {
            registrationErrorMessage.value = `Registration is full! All ${result.playerCap} spots have been taken.`;
          } else {
            registrationErrorMessage.value = result.message || 'Registration failed. Please try again.';
          }
        }
      } catch (err) {
        const friendlyMessage = getErrorMessage(err, 'registration');
        registrationErrorMessage.value = friendlyMessage;
      }
    };

    const confirmUnregistration = async (data) => {
      if (!currentUnregistrationData.value) {
        unregistrationErrorMessage.value = 'Error: No player data found. Please close this dialog and try looking up your player again.';
        return;
      }
      
      const { player, index } = currentUnregistrationData.value;
      
      // Clear any previous messages
      unregistrationSuccessMessage.value = '';
      unregistrationErrorMessage.value = '';
      
      try {
        const payload = {
          bttc_id: player.bttc_id,
          first_name: player.first_name,
          last_name: player.last_name,
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
          // Set success message instead of alert
          unregistrationSuccessMessage.value = result.message || 'Unregistration completed successfully!';
          
          // Update local state instead of making another API call
          // Mark the player as unregistered in the local players array
          if (players.value[index]) {
            players.value[index].is_registered = false;
            // Clear any error fields
            players.value[index].registerError = '';
            players.value[index].unregisterError = '';
          }
          
          // Extract capacity from unregistration response (new API always includes capacity)
          if (result.capacity) {
            updateCapacityFromResponse(result.capacity);
          }
          // Don't close the dialog - let user see success message and click Close button
        } else {
          unregistrationErrorMessage.value = result.message || 'Unregistration failed. Please try again.';
        }
      } catch (err) {
        const friendlyMessage = getErrorMessage(err, 'unregistration');
        unregistrationErrorMessage.value = friendlyMessage;
      }
    };

    // Lifecycle
    onMounted(() => {
      checkRegistrationStatus();
      // Only fetch event metadata if registration is open
      if (registrationOpen.value) {
        fetchEventMetadata(); // Fetch event date from cache or API
      }
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
      registrationSuccessMessage,
      registrationErrorMessage,
      unregistrationSuccessMessage,
      unregistrationErrorMessage,
      error,
      devOverride,
      closingTime,
      nextOpening,
      formattedEventDate,
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
      <div v-if="registrationOpen" class="roster-section">
        <a href="../roster/" class="roster-link-button">
          <span class="roster-text">View Players Registered for Round Robin</span>
          <span class="roster-subtext">See current RR registrations</span>
        </a>
      </div>

      <div class="page-header">
        <h2>Round Robin Registration</h2>
        <p v-if="formattedEventDate" class="event-date"><span class="event-date-label">For</span> {{ formattedEventDate }}</p>
      </div>

      <registration-status 
        v-if="!registrationOpen"
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
            <a href="../signup/" class="signup-button">
              <span class="signup-button-text">Sign up (Returning Players)</span>
              <span class="signup-button-subtext">Activate your online player account</span>
            </a>
          </div>
          
          <div class="error-support">
            <p class="support-text">Need help or new to Friday Night League? Contact BTTC support.</p>
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
        <a href="../signup/" class="signup-button">
          <span class="signup-button-text">Sign Up Another Returning Player</span>
          <span class="signup-button-subtext">Activate another returning player online account</span>
        </a>
      </div>

      <registration-dialog 
        :show="showRegistrationDialog"
        :player="currentRegistrationData?.player"
        :success-message="registrationSuccessMessage"
        :error-message="registrationErrorMessage"
        @close="showRegistrationDialog = false"
        @confirm="confirmRegistration"
      />

      <unregistration-dialog 
        :show="showUnregistrationDialog"
        :player="currentUnregistrationData?.player"
        :success-message="unregistrationSuccessMessage"
        :error-message="unregistrationErrorMessage"
        @close="showUnregistrationDialog = false"
        @confirm="confirmUnregistration"
      />
    </div>
  `
};

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
