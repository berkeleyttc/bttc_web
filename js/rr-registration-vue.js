/**
 * BTTC Round Robin Registration - Vue.js
 * 
 * Simple and elegant registration form.
 * 
 * @file js/rr-registration-vue.js
 */

const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

// ========================================
// ERROR HANDLING UTILITY
// ========================================

/**
 * Converts errors to user-friendly messages
 * @param {Error|object} error - The error object
 * @param {string} context - Context of the operation (for debugging)
 * @returns {string} - User-friendly error message
 */
const getErrorMessage = (error, context = 'operation') => {
  const errorMessage = error?.message || String(error || '');
  const errorName = error?.name || '';
  
  // Network errors (API down, connection refused, timeout, etc.)
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
  
  // HTTP response errors
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
 * Creates fetch options with API headers if configured
 * @param {object} options - Original fetch options
 * @returns {object} - Fetch options with headers
 */
const getFetchOptions = (options = {}) => {
  const apiKey = typeof ENV !== 'undefined' ? ENV.API_KEY : '';
  
  // If API_KEY is configured, add X-API-Key header
  if (apiKey) {
    // Handle both Headers object and plain object
    let headers;
    if (options.headers instanceof Headers) {
      headers = new Headers(options.headers);
    } else {
      headers = new Headers(options.headers || {});
    }
    headers.set('X-API-Key', apiKey);
    
    return {
      ...options,
      headers: headers
    };
  }
  
  return options;
};

/**
 * Handles API response and checks for errors
 * @param {Response} response - Fetch API response
 * @returns {Promise<object>} - Parsed JSON data
 * @throws {Error} - If response is not OK or JSON parsing fails
 */
const handleApiResponse = async (response) => {
  if (!response.ok) {
    let errorMessage = 'Server error';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch {
      // If response is not JSON, use status text
      errorMessage = response.statusText || `HTTP ${response.status}`;
    }
    
    const error = new Error(errorMessage);
    error.response = response;
    throw error;
  }
  
  try {
    const data = await response.json();
    return data;
  } catch (jsonError) {
    throw new Error('Invalid response from server. Please try again.');
  }
};

// ========================================
// REGISTRATION STATUS COMPONENT
// ========================================
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
        <span v-if="isOpen && !devMode">Closes today at {{ closingTime }} PST</span>
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
const CapacityBanner = {
  props: {
    capacity: Object
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
      </div>
    </div>
  `,
  computed: {
    capacityClass() {
      return this.capacity.isAtCapacity ? 'capacity-full' : 'capacity-available';
    }
  }
};

// ========================================
// PHONE HISTORY UTILITY
// ========================================
const PHONE_HISTORY_KEY = 'bttc_phone_history';
const MAX_HISTORY_ITEMS = 10;

/**
 * Get phone number history from localStorage
 * @returns {string[]} Array of phone numbers
 */
const getPhoneHistory = () => {
  try {
    const history = localStorage.getItem(PHONE_HISTORY_KEY);
    return history ? JSON.parse(history) : [];
  } catch (err) {
    return [];
  }
};

/**
 * Save phone number to history
 * @param {string} phone - Phone number to save (cleaned, 10 digits)
 */
const savePhoneToHistory = (phone) => {
  try {
    const history = getPhoneHistory();
    // Remove if already exists (to move to top)
    const filtered = history.filter(p => p !== phone);
    // Add to beginning
    filtered.unshift(phone);
    // Keep only max items
    const trimmed = filtered.slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(PHONE_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // Silent fail
  }
};

// ========================================
// PLAYER LOOKUP COMPONENT
// ========================================
const PlayerLookup = {
  props: {
    registrationOpen: Boolean
  },
  emits: ['player-found', 'lookup-error'],
  setup(props, { emit }) {
    // State
    const phoneInput = ref('');
    const isLookingUp = ref(false);
    const phoneError = ref('');
    const phoneHistory = ref([]);

    /**
     * Validates phone number format
     * @param {string} phone - Raw phone input
     * @returns {object} - { valid: boolean, phone?: string, message?: string }
     */
    const validatePhone = (phone) => {
      // Remove all non-digits
      const digitsOnly = phone.replace(/\D/g, '');
      
      // Remove leading 1 if present
      const cleaned = digitsOnly.replace(/^1/, '');
      
      // Check if empty
      if (!cleaned) {
        return { valid: false, message: 'Please enter a phone number.' };
      }
      
      // Check length
      const requiredLength = typeof ENV !== 'undefined' ? ENV.PHONE_NUMBER_LENGTH : 10;
      if (cleaned.length < requiredLength) {
        return { valid: false, message: `Phone number must be at least ${requiredLength} digits.` };
      }
      
      if (cleaned.length > requiredLength) {
        return { valid: false, message: `Phone number must be exactly ${requiredLength} digits.` };
      }
      
      // Validate area code (can't start with 0 or 1)
      const areaCode = cleaned.substring(0, 3);
      if (areaCode[0] === '0' || areaCode[0] === '1') {
        return { valid: false, message: 'Invalid area code. Area codes cannot start with 0 or 1.' };
      }
      
      // Validate exchange code (can't start with 0 or 1)
      const exchangeCode = cleaned.substring(3, 6);
      if (exchangeCode[0] === '0' || exchangeCode[0] === '1') {
        return { valid: false, message: 'Invalid phone number format.' };
      }
      
      return { valid: true, phone: cleaned };
    };

    /**
     * Handles form submission
     */
    const handleSubmit = async (e) => {
      e.preventDefault();
      
      // Check registration status
      if (!props.registrationOpen) {
        alert('Registration is currently closed. Please check the status banner above for when it will reopen.');
        return;
      }

      // Validate phone number
      const validation = validatePhone(phoneInput.value);
      if (!validation.valid) {
        phoneError.value = validation.message;
        emit('lookup-error', validation.message);
        return;
      }
      
      // Clear previous errors
      phoneError.value = '';
      const phone = validation.phone;

      // Set loading state
      isLookingUp.value = true;
      
      try {
        // Make API request
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const url = `${apiUrl}/rr/search?phone=${encodeURIComponent(phone)}`;
        
        const fetchOptions = getFetchOptions();
        const response = await fetch(url, fetchOptions);
        const data = await handleApiResponse(response);
        
        // Save phone to history on successful lookup
        savePhoneToHistory(phone);
        // Refresh history list
        phoneHistory.value = getPhoneHistory();
        
        emit('player-found', data);
        
      } catch (error) {
        const friendlyMessage = getErrorMessage(error, 'player lookup');
        emit('lookup-error', friendlyMessage);
      } finally {
        isLookingUp.value = false;
      }
    };

    // Load phone history on mount
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
              maxlength="16" 
              placeholder="(510) 123-4567" 
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
const PlayerList = {
  props: {
    players: Array,
    capacity: Object
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
      unregisterPlayer
    };
  },
  template: `
    <div v-if="players.length > 0" class="result">
      <p class="success">Manage your registration:</p>
      <capacity-banner :capacity="capacity" />
      
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
const RegistrationDialog = {
  props: {
    show: Boolean,
    player: Object
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    const paymentMethod = ref('');
    const comments = ref('');

    const handleConfirm = () => {
      if (!paymentMethod.value) {
        alert('Please select a payment method.');
        return;
      }

      const data = {
        paymentMethod: paymentMethod.value,
        comments: comments.value
      };
      emit('confirm', data);
    };

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
const UnregistrationDialog = {
  props: {
    show: Boolean,
    player: Object
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    const comments = ref('');

    const handleConfirm = () => {
      emit('confirm', {
        comments: comments.value
      });
    };

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
const RegistrationApp = {
  components: {
    RegistrationStatus,
    PlayerLookup,
    PlayerList,
    RegistrationDialog,
    UnregistrationDialog
  },
  setup() {
    // Load constants from ENV first
    const devOverride = typeof ENV !== 'undefined' ? ENV.DEV_OVERRIDE : false;
    const registrationDay = typeof ENV !== 'undefined' ? ENV.REGISTRATION_DAY : 5;
    const closingHour = typeof ENV !== 'undefined' ? ENV.REGISTRATION_CLOSING_HOUR : 18;
    const closingMinute = typeof ENV !== 'undefined' ? ENV.REGISTRATION_CLOSING_MINUTE : 45;
    const timezone = typeof ENV !== 'undefined' ? ENV.TIMEZONE : 'America/Los_Angeles';
    const defaultPlayerCap = typeof ENV !== 'undefined' ? ENV.DEFAULT_PLAYER_CAP : 64;
    const fallbackPlayerCap = typeof ENV !== 'undefined' ? ENV.FALLBACK_PLAYER_CAP : 65;
    const supportPhone = typeof ENV !== 'undefined' ? ENV.SUPPORT_PHONE : '510-926-6913';
    const supportMethod = typeof ENV !== 'undefined' ? ENV.SUPPORT_METHOD : 'TEXT ONLY';
    
    // Reactive state
    const players = ref([]);
    const registrationOpen = ref(false);
    const capacity = ref({
      isAtCapacity: false,
      confirmedCount: 0,
      playerCap: fallbackPlayerCap,
      spotsAvailable: 0
    });
    const showRegistrationDialog = ref(false);
    const showUnregistrationDialog = ref(false);
    const currentRegistrationData = ref(null);
    const currentUnregistrationData = ref(null);
    const error = ref('');

    // Computed properties
    const closingTime = computed(() => {
      const now = new Date();
      const pstNow = new Date(now.toLocaleString("en-US", {timeZone: timezone}));
      const closingTime = new Date(pstNow);
      closingTime.setHours(closingHour, closingMinute, 0, 0);
      return closingTime.toLocaleString("en-US", {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit'
      });
    });

    const nextOpening = computed(() => {
      const now = new Date();
      const pstNow = new Date(now.toLocaleString("en-US", {timeZone: timezone}));
      const dayOfWeek = pstNow.getDay();
      
      let daysUntilRegistrationDay;
      if (dayOfWeek === registrationDay) {
        daysUntilRegistrationDay = 7;
      } else {
        daysUntilRegistrationDay = (registrationDay - dayOfWeek + 7) % 7;
        if (daysUntilRegistrationDay === 0) daysUntilRegistrationDay = 7;
      }

      const nextRegistrationDay = new Date(pstNow);
      nextRegistrationDay.setDate(nextRegistrationDay.getDate() + daysUntilRegistrationDay);
      nextRegistrationDay.setHours(0, 0, 0, 0);

      return nextRegistrationDay.toLocaleString("en-US", {
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
      const dayOfWeek = pstNow.getDay();
      const hours = pstNow.getHours();
      const minutes = pstNow.getMinutes();

      if (dayOfWeek === registrationDay) {
        if (hours < closingHour || (hours === closingHour && minutes <= closingMinute)) {
          return true;
        }
      }
      return false;
    };

    const checkRegistrationStatus = () => {
      registrationOpen.value = isRegistrationOpen();
    };

    const checkRegistrationCapacity = async () => {
      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const fetchOptions = getFetchOptions({ method: 'POST' });
        const response = await fetch(`${apiUrl}/rr/capacity`, fetchOptions);
        const data = await handleApiResponse(response);
        capacity.value = {
          isAtCapacity: !!data.roster_full,
          confirmedCount: Number(data.confirmed_count || 0),
          playerCap: Number(data.player_cap || defaultPlayerCap),
          spotsAvailable: Number(data.spots_available || 0),
          eventOpen: !!data.event_open
        };
        // Clear any previous capacity errors on success
        if (error.value && error.value.includes('capacity')) {
          error.value = '';
        }
      } catch (err) {
        // Set capacity defaults to prevent UI issues
        capacity.value = { isAtCapacity: false, confirmedCount: 0, playerCap: fallbackPlayerCap, spotsAvailable: 0, eventOpen: false };
        
        // Clear players list to hide registration section
        players.value = [];
        
        // Escalate to support - show user-friendly error message
        const friendlyMessage = getErrorMessage(err, 'capacity check');
        error.value = `Unable to check registration capacity. ${friendlyMessage}`;
      }
    };

    const handlePlayerFound = (data) => {
      if (data.result === "None" || data.length === 0) {
        error.value = 'No player found for this phone number.';
        players.value = [];
        return;
      }

      error.value = '';
      players.value = data.map(player => ({
        ...player,
        registerToken: '',
        unregisterToken: '',
        registerError: '',
        unregisterError: ''
      }));
      
      checkRegistrationCapacity();
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

      if (capacity.value.isAtCapacity) {
        alert(`Registration is full! All ${capacity.value.playerCap} spots have been taken.`);
        return;
      }

      const player = players.value[index];
      
      if (!player.registerToken) {
        player.registerError = "Please enter your PIN.";
        return;
      }

      currentRegistrationData.value = { player, index };
      showRegistrationDialog.value = true;
    };

    const handleUnregisterPlayer = (index) => {
      const player = players.value[index];
      if (!player.unregisterToken) {
        player.unregisterError = "Please enter your PIN.";
        return;
      }

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
        const payload = {
          bttc_id: player.bttc_id,
          first_name: player.first_name,
          last_name: player.last_name,
          token: player.registerToken,
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
          players.value = [];
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
        const payload = {
          bttc_id: player.bttc_id,
          first_name: player.first_name,
          last_name: player.last_name,
          token: player.unregisterToken,
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
          // Refresh the display
          const phone = document.querySelector('input[type="tel"]')?.value?.trim().replace(/^1|\D/g, '');
          if (phone) {
            try {
              const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
              const refreshFetchOptions = getFetchOptions();
              const refreshResponse = await fetch(`${apiUrl}/rr/search?phone=${encodeURIComponent(phone)}`, refreshFetchOptions);
              const refreshData = await handleApiResponse(refreshResponse);
              handlePlayerFound(refreshData);
            } catch (refreshErr) {
              // Silent fail for background refresh
            }
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
    <div class="container" :class="{ 'registration-disabled': !registrationOpen }">
      <h2 style="font-family: Arial, sans-serif; font-weight: bold;">Round Robin Sign-Up</h2>

      <registration-status 
        :is-open="registrationOpen"
        :closing-time="closingTime"
        :next-opening="nextOpening"
        :dev-mode="devOverride"
      />

      <player-lookup 
        :registration-open="registrationOpen"
        @player-found="handlePlayerFound"
        @lookup-error="handleLookupError"
      />

      <div v-if="error" class="result">
        <p class="error">{{ error }}</p>
        <a href="player_signup.html" class="signup-link">
          PLAYER INFO SIGNUP
        </a>
        <p>Otherwise Contact BTTC support at {{ supportPhone }} ({{ supportMethod }})</p>
      </div>

      <player-list 
        v-if="!error || !error.includes('capacity')"
        :players="players"
        :capacity="capacity"
        @register-player="handleRegisterPlayer"
        @unregister-player="handleUnregisterPlayer"
      />

      <div class="roster-section">
        <a href="bttc_roster_vue.html" class="roster-link-button">
          <span class="roster-text">View Registered Players</span>
          <span class="roster-subtext">See current registrations</span>
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
