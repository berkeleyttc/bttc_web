/**
 * BTTC Player Signup - Vue.js
 * 
 * Complete your player profile for Berkeley Table Tennis Club registration.
 * 
 * DEBUGGING GUIDE:
 * - All debug logs use [PlayerSignup] prefix for easy filtering
 * - console.debug() for normal flow tracking
 * - console.warn() for warnings/non-critical issues
 * - console.error() for errors
 * - Open browser console and filter by [PlayerSignup] to see all logs
 * 
 * @file js/player-signup-vue.js
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
  console.debug('[PlayerSignup] Processing error:', { error, context });
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
    console.warn('[PlayerSignup] Network error detected');
    const supportContact = typeof ENV !== 'undefined' 
      ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
      : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
    return `Unable to connect to the server. The registration service may be temporarily unavailable. Please try again in a few moments or ${supportContact}.`;
  }
  
  // HTTP response errors
  if (error && error.response) {
    const status = error.response.status;
    console.debug('[PlayerSignup] HTTP error:', status);
    
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
    console.debug('[PlayerSignup] Generic error:', error.message);
    const supportContact = typeof ENV !== 'undefined' 
      ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
      : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
    return `An error occurred during ${context}: ${error.message}. Please try again or ${supportContact}.`;
  }
  
  console.warn('[PlayerSignup] Unknown error format');
  const supportContact = typeof ENV !== 'undefined' 
    ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
    : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
  return `An unexpected error occurred during ${context}. Please try again or ${supportContact}.`;
};

/**
 * Creates fetch options with API headers if configured
 * DEBUG: Check browser console for [PlayerSignup][ApiHandler] logs to verify API key is being sent
 * @param {object} options - Original fetch options
 * @returns {object} - Fetch options with headers
 */
const getFetchOptions = (options = {}) => {
  const apiKey = typeof ENV !== 'undefined' ? ENV.API_KEY : '';
  
  console.debug('[PlayerSignup][ApiHandler] getFetchOptions called');
  console.debug('[PlayerSignup][ApiHandler] ENV defined:', typeof ENV !== 'undefined');
  console.debug('[PlayerSignup][ApiHandler] API_KEY value:', apiKey ? '***SET***' : 'NOT SET');
  
  // If API_KEY is configured, add X-API-Key header
  if (apiKey) {
    // Ensure we have a clean headers object
    const existingHeaders = options.headers || {};
    const headers = {
      ...(existingHeaders instanceof Headers 
        ? Object.fromEntries(existingHeaders.entries()) 
        : existingHeaders),
      'X-API-Key': apiKey
    };
    
    console.debug('[PlayerSignup][ApiHandler] Adding X-API-Key header to request');
    console.debug('[PlayerSignup][ApiHandler] Headers being sent:', { ...headers, 'X-API-Key': '***REDACTED***' });
    
    return {
      ...options,
      headers: headers
    };
  }
  
  console.warn('[PlayerSignup][ApiHandler] No API key found, returning options without X-API-Key header');
  return options;
};

/**
 * Handles API response and checks for errors
 * DEBUG: Check [PlayerSignup][ApiHandler] logs for response status and parsing issues
 * @param {Response} response - Fetch API response
 * @returns {Promise<object>} - Parsed JSON data
 * @throws {Error} - If response is not OK or JSON parsing fails
 */
const handleApiResponse = async (response) => {
  console.debug('[PlayerSignup][ApiHandler] Response status:', response.status, response.statusText);
  
  if (!response.ok) {
    let errorMessage = 'Server error';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
      console.debug('[PlayerSignup][ApiHandler] Error data:', errorData);
    } catch {
      // If response is not JSON, use status text
      errorMessage = response.statusText || `HTTP ${response.status}`;
      console.debug('[PlayerSignup][ApiHandler] Non-JSON error response');
    }
    
    const error = new Error(errorMessage);
    error.response = response;
    throw error;
  }
  
  try {
    const data = await response.json();
    console.debug('[PlayerSignup][ApiHandler] Response parsed successfully');
    return data;
  } catch (jsonError) {
    console.error('[PlayerSignup][ApiHandler] JSON parse error:', jsonError);
    throw new Error('Invalid response from server. Please try again.');
  }
};

// ========================================
// PLAYER SEARCH COMPONENT
// ========================================
const PlayerSearch = {
  emits: ['players-found', 'search-error'],
  setup(props, { emit }) {
    const searchType = ref('lastname');
    const searchInput = ref('');
    const isSearching = ref(false);

    const searchPlaceholder = computed(() => {
      return searchType.value === 'lastname' 
        ? 'Enter your last name' 
        : 'Enter your BTTC ID';
    });

    const handleSubmit = async (e) => {
      e.preventDefault();
      
      const searchValue = searchInput.value.trim();
      console.debug('[PlayerSignup][PlayerSearch] Search submitted:', { searchType: searchType.value, searchValue });
      
      if (!searchValue) {
        console.warn('[PlayerSignup][PlayerSearch] Empty search value');
        emit('search-error', 'Please enter a search term.');
        return;
      }

      isSearching.value = true;
      
      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const url = `${apiUrl}/player/search?type=${searchType.value}&value=${encodeURIComponent(searchValue)}`;
        console.debug('[PlayerSignup][PlayerSearch] Fetching:', url);
        
        const fetchOptions = getFetchOptions();
        const response = await fetch(url, fetchOptions);
        const data = await handleApiResponse(response);
        
        console.debug('[PlayerSignup][PlayerSearch] Search successful:', { playersFound: data.players?.length || 0 });
        emit('players-found', data);
      } catch (error) {
        console.error('[PlayerSignup][PlayerSearch] Search failed:', error);
        const friendlyMessage = getErrorMessage(error, 'player search');
        emit('search-error', friendlyMessage);
      } finally {
        isSearching.value = false;
      }
    };

    return {
      searchType,
      searchInput,
      isSearching,
      searchPlaceholder,
      handleSubmit
    };
  },
  template: `
    <div>
      <h1>Complete Your Player Profile</h1>
      <p class="subtitle">Find yourself in our system and complete your registration information</p>
      
      <div class="search-type">
        <label>
          <input type="radio" v-model="searchType" value="lastname" /> Search by Last Name
        </label>
        <label>
          <input type="radio" v-model="searchType" value="bttcid" /> Search by BTTC ID
        </label>
      </div>

      <form @submit="handleSubmit">
        <div class="search-container">
          <input 
            type="text" 
            v-model="searchInput"
            :placeholder="searchPlaceholder"
            required 
            :disabled="isSearching"
          />
          <button type="submit" :disabled="isSearching">
            <span v-if="!isSearching">Search</span>
            <span v-else>
              Searching<span class="loading-spinner"></span>
            </span>
          </button>
        </div>
      </form>
    </div>
  `
};

// ========================================
// PLAYER RESULTS COMPONENT
// ========================================
const PlayerResults = {
  props: {
    players: Array,
    totalFound: Number,
    availableForSignup: Number
  },
  emits: ['player-selected'],
  setup(props, { emit }) {
    const selectPlayer = (player) => {
      if (!player.already_signed_up) {
        emit('player-selected', player);
      }
    };

    return {
      selectPlayer
    };
  },
  template: `
    <div class="result">
      <div class="info">Click on your name to complete your registration:</div>
      
      <div 
        v-for="player in players" 
        :key="player.bttc_id"
        class="player-result"
        :class="{ 'selected': player.already_signed_up }"
        @click="selectPlayer(player)"
        :style="{ cursor: player.already_signed_up ? 'not-allowed' : 'pointer', opacity: player.already_signed_up ? 0.6 : 1 }"
      >
        <div class="player-name">{{ player.first_name }} {{ player.last_name }}</div>
        <div class="player-id">BTTC ID: {{ player.bttc_id }}</div>
        <div v-if="player.already_signed_up" style="color: #198754; font-weight: bold; margin-top: 0.5rem;">
          ✓ Already signed up
        </div>
      </div>

      <div 
        v-if="totalFound > availableForSignup"
        class="info" 
        style="margin-top: 1rem; font-size: 0.9rem;"
      >
        Found {{ totalFound }} total matches, showing {{ availableForSignup }} available for signup.
      </div>
    </div>
  `
};

// ========================================
// PLAYER DIALOG COMPONENT
// ========================================
const PlayerDialog = {
  props: {
    show: Boolean,
    player: Object
  },
  emits: ['close', 'submit'],
  setup(props, { emit }) {
    const phoneNumber = ref('');
    const email = ref('');
    const userToken = ref('');
    const phoneError = ref('');
    const emailError = ref('');
    const tokenError = ref('');
    const isSubmitting = ref(false);

    const validatePhone = (phone) => {
      const phoneRegex = /^\d{10}$/;
      return phoneRegex.test(phone);
    };

    const validateEmail = (emailValue) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(emailValue);
    };

    const validateToken = (token) => {
      const tokenRegex = /^\d{6}$/;
      return tokenRegex.test(token);
    };

    const clearValidationErrors = () => {
      phoneError.value = '';
      emailError.value = '';
      tokenError.value = '';
    };

    const handleClose = () => {
      phoneNumber.value = '';
      email.value = '';
      userToken.value = '';
      clearValidationErrors();
      emit('close');
    };

    const handleSubmit = () => {
      clearValidationErrors();
      let isValid = true;

      const phone = phoneNumber.value.trim();
      const emailValue = email.value.trim();
      const token = userToken.value.trim();

      if (!validatePhone(phone)) {
        phoneError.value = 'Please enter a valid 10-digit phone number';
        isValid = false;
      }

      if (!validateEmail(emailValue)) {
        emailError.value = 'Please enter a valid email address';
        isValid = false;
      }

      if (!validateToken(token)) {
        tokenError.value = 'PIN must be exactly 6 digits';
        isValid = false;
      }

      if (!isValid) return;

      isSubmitting.value = true;

      emit('submit', {
        phoneNumber: phone,
        email: emailValue,
        token: token,
        setSubmitting: (value) => { isSubmitting.value = value; }
      });
    };

    return {
      phoneNumber,
      email,
      userToken,
      phoneError,
      emailError,
      tokenError,
      isSubmitting,
      handleClose,
      handleSubmit
    };
  },
  template: `
    <div 
      class="dialog-overlay" 
      :class="{ 'show': show }"
      @click="handleClose"
    >
      <div class="dialog-box" @click.stop>
        <div class="dialog-title">Complete Your Information</div>
        
        <div class="player-info" v-if="player">
          <strong>{{ player.first_name }} {{ player.last_name }}</strong><br>
          BTTC ID: {{ player.bttc_id }}
        </div>

        <form @submit.prevent="handleSubmit">
          <div class="form-group">
            <label for="phoneNumber">Phone Number *</label>
            <input 
              type="tel" 
              id="phoneNumber"
              v-model="phoneNumber"
              placeholder="e.g., 5101234567" 
              required 
              :disabled="isSubmitting"
            />
            <div class="help-text">Enter 10 digits without spaces or dashes</div>
            <div v-if="phoneError" class="validation-error">{{ phoneError }}</div>
          </div>

          <div class="form-group">
            <label for="email">Email Address *</label>
            <input 
              type="email" 
              id="email"
              v-model="email"
              placeholder="e.g., john@example.com" 
              required 
              :disabled="isSubmitting"
            />
            <div v-if="emailError" class="validation-error">{{ emailError }}</div>
          </div>

          <div class="token-section">
            <h4>Create Your Personal PIN</h4>
            <div class="form-group">
              <label for="userToken">Personal PIN *</label>
              <input 
                type="text" 
                id="userToken"
                v-model="userToken"
                placeholder="Enter your 6-digit PIN" 
                maxlength="6" 
                required 
                :disabled="isSubmitting"
              />
              <div class="help-text">Choose a 6-digit PIN that you'll remember (numbers only)</div>
              <div v-if="tokenError" class="validation-error">{{ tokenError }}</div>
            </div>
          </div>

          <div class="dialog-buttons">
            <button 
              type="button" 
              class="dialog-btn dialog-btn-secondary" 
              @click="handleClose"
              :disabled="isSubmitting"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              class="dialog-btn dialog-btn-primary"
              :disabled="isSubmitting"
            >
              <span v-if="!isSubmitting">Complete Player Signup</span>
              <span v-else>Submitting...</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  `
};

// ========================================
// MAIN PLAYER SIGNUP APP COMPONENT
// ========================================
const PlayerSignupApp = {
  components: {
    PlayerSearch,
    PlayerResults,
    PlayerDialog
  },
  setup() {
    const searchResults = ref([]);
    const totalFound = ref(0);
    const availableForSignup = ref(0);
    const selectedPlayer = ref(null);
    const showDialog = ref(false);
    const error = ref('');
    const successMessage = ref('');

    const handlePlayersFound = (data) => {
      console.debug('[PlayerSignup][App] Players found:', { total: data.total_found, available: data.available_for_signup, players: data.players?.length || 0 });
      error.value = '';
      successMessage.value = '';

      if (data.error) {
        console.warn('[PlayerSignup][App] Error in response:', data.error);
        error.value = data.error;
        searchResults.value = [];
        return;
      }

      if (!data.players || data.players.length === 0) {
        if (data.total_found > 0 && data.available_for_signup === 0) {
          console.debug('[PlayerSignup][App] All found players already signed up');
          error.value = 'Found players matching your search, but they have already completed their signup. If this is incorrect, please contact BTTC support.';
        } else {
          console.debug('[PlayerSignup][App] No players found');
          error.value = 'No players found. Please check your spelling or contact BTTC support at 510-926-6913 (TEXT ONLY)';
        }
        searchResults.value = [];
        return;
      }

      searchResults.value = data.players;
      totalFound.value = data.total_found || data.players.length;
      availableForSignup.value = data.available_for_signup || data.players.filter(p => !p.already_signed_up).length;
      console.debug('[PlayerSignup][App] Search results set:', { totalFound: totalFound.value, availableForSignup: availableForSignup.value });
    };

    const handleSearchError = (errorMessage) => {
      error.value = errorMessage;
      successMessage.value = '';
      searchResults.value = [];
    };

    const handlePlayerSelected = (player) => {
      console.debug('[PlayerSignup][App] Player selected:', { bttc_id: player.bttc_id, name: `${player.first_name} ${player.last_name}` });
      selectedPlayer.value = player;
      showDialog.value = true;
    };

    const handleDialogClose = () => {
      showDialog.value = false;
      selectedPlayer.value = null;
    };

    const handleDialogSubmit = async (formData) => {
      const { phoneNumber, email, token, setSubmitting } = formData;
      console.debug('[PlayerSignup][App] Submitting signup:', { bttc_id: selectedPlayer.value.bttc_id, phone: phoneNumber, email });

      const payload = {
        bttc_id: selectedPlayer.value.bttc_id,
        first_name: selectedPlayer.value.first_name,
        last_name: selectedPlayer.value.last_name,
        phone_number: phoneNumber,
        email: email,
        token: token
      };

      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const url = `${apiUrl}/player/signup`;
        console.debug('[PlayerSignup][App] Submitting to:', url);

        const fetchOptions = getFetchOptions({
          method: 'POST',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const response = await fetch(url, fetchOptions);
        const data = await handleApiResponse(response);

        if (data.success) {
          console.debug('[PlayerSignup][App] Signup successful');
          successMessage.value = 'Registration completed successfully! You can now use your phone number to register for round robin events.';
          error.value = '';
          searchResults.value = [];
          showDialog.value = false;
          selectedPlayer.value = null;
        } else {
          console.warn('[PlayerSignup][App] Signup failed:', data.message);
          alert('Registration failed: ' + (data.message || 'Unknown error'));
        }
      } catch (err) {
        console.error('[PlayerSignup][App] Signup error:', err);
        const friendlyMessage = getErrorMessage(err, 'registration');
        alert('Registration failed: ' + friendlyMessage);
      } finally {
        setSubmitting(false);
      }
    };

    return {
      searchResults,
      totalFound,
      availableForSignup,
      selectedPlayer,
      showDialog,
      error,
      successMessage,
      handlePlayersFound,
      handleSearchError,
      handlePlayerSelected,
      handleDialogClose,
      handleDialogSubmit
    };
  },
  template: `
    <div class="container">
      <a href="bttc_rr_registration_vue.html" class="back-link">← Back to Round Robin Registration</a>
      
      <div v-if="successMessage">
        <div class="success">
          {{ successMessage }}
        </div>
        <a href="bttc_rr_registration_vue.html" class="registration-link-button">
          <span class="registration-link-button-text">→ Go to Round Robin Registration</span>
          <span class="registration-link-button-subtext">Register for the next round robin event</span>
        </a>
      </div>

      <template v-else>
        <player-search 
          @players-found="handlePlayersFound"
          @search-error="handleSearchError"
        />

        <div v-if="error" class="result">
          <div class="error">{{ error }}</div>
        </div>

        <player-results 
          v-if="searchResults.length > 0"
          :players="searchResults"
          :total-found="totalFound"
          :available-for-signup="availableForSignup"
          @player-selected="handlePlayerSelected"
        />
      </template>

      <player-dialog 
        :show="showDialog"
        :player="selectedPlayer"
        @close="handleDialogClose"
        @submit="handleDialogSubmit"
      />
    </div>
  `
};

// ========================================
// CREATE VUE APP
// ========================================
const app = createApp({
  components: {
    PlayerSignupApp
  },
  errorHandler: (err, instance, info) => {
    // Handle Vue component errors gracefully
    console.error('Vue error:', err, info);
  }
});

// Mount the app
app.mount('#vue-player-signup-app');

// Handle unhandled promise rejections (network errors, etc.)
window.addEventListener('unhandledrejection', (event) => {
  // If it's a network error, we've already handled it in our try-catch blocks
  const error = event.reason;
  if (error && (error instanceof TypeError || error?.message?.includes('fetch'))) {
    event.preventDefault();
  }
});

