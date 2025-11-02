/**
 * BTTC Player Signup - Vue.js
 * 
 * Complete your player profile for Berkeley Table Tennis Club registration.
 * 
 * APPLICATION OVERVIEW:
 * This Vue.js application allows players to find themselves in the BTTC system
 * and complete their player profile by adding phone number, email, and PIN.
 * 
 * COMPONENT STRUCTURE:
 * - PlayerSearch: Allows searching by last name or BTTC ID
 * - PlayerResults: Displays search results with clickable player cards
 * - PlayerDialog: Modal form to collect phone, email, and PIN
 * - PlayerSignupApp: Main app component that orchestrates the flow
 * 
 * DATA FLOW:
 * 1. User searches for player → PlayerSearch component emits 'players-found'
 * 2. Results displayed → PlayerResults component shows matching players
 * 3. User clicks player → Opens PlayerDialog modal
 * 4. User submits form → POST to /player/signup API
 * 5. Success → Shows success message and link to RR registration
 * 
 * @file js/player-signup-vue.js
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
 * @param {string} context - Context of the operation (e.g., 'player search', 'registration')
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
// PLAYER SEARCH COMPONENT
// ========================================

/**
 * PlayerSearch Component
 * 
 * PURPOSE: Allows users to search for their player profile by last name or BTTC ID
 * 
 * USER FLOW:
 * 1. User selects search type (last name or BTTC ID)
 * 2. User enters search term and clicks Search
 * 3. Component makes API call to /player/search
 * 4. On success: emits 'players-found' with results
 * 5. On error: emits 'search-error' with error message
 * 
 * STATE:
 * - searchType: 'lastname' or 'bttcid' (radio button selection)
 * - searchInput: User's typed search term
 * - isSearching: Loading state during API call
 */
const PlayerSearch = {
  emits: ['players-found', 'search-error'],
  setup(props, { emit }) {
    // Component state: search configuration and user input
    const searchType = ref('lastname');  // Default to searching by last name
    const searchInput = ref('');          // User's search input
    const isSearching = ref(false);       // Loading indicator state

    // Dynamically update placeholder text based on selected search type
    const searchPlaceholder = computed(() => {
      return searchType.value === 'lastname' 
        ? 'Enter your last name' 
        : 'Enter your BTTC ID';
    });

    /**
     * Handles input for BTTC ID - only allows numeric characters
     * Filters out any non-numeric input when searching by BTTC ID
     */
    const handleInput = (e) => {
      if (searchType.value === 'bttcid') {
        // Remove any non-numeric characters
        const numericOnly = e.target.value.replace(/\D/g, '');
        searchInput.value = numericOnly;
      }
    };

    /**
     * Handles search form submission
     * 
     * FLOW:
     * 1. Validate that user entered a search term
     * 2. Set loading state (disables form, shows spinner)
     * 3. Make API call to /player/search with search type and value
     * 4. Emit results to parent component or error if failed
     * 5. Always reset loading state in finally block
     */
    const handleSubmit = async (e) => {
      e.preventDefault();
      
      const searchValue = searchInput.value.trim();
      
      // Validate: ensure user entered something to search for
      if (!searchValue) {
        emit('search-error', 'Please enter a search term.');
        return;
      }

      // Validate BTTC ID is numeric if searching by BTTC ID
      if (searchType.value === 'bttcid') {
        if (!/^\d+$/.test(searchValue)) {
          emit('search-error', 'BTTC ID must contain only numbers.');
          return;
        }
      }

      // Set loading state to disable form and show spinner
      isSearching.value = true;
      
      try {
        // Build API URL with search parameters
        // type can be 'lastname' or 'bttcid', value is URL-encoded search term
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const url = `${apiUrl}/player/search?type=${searchType.value}&value=${encodeURIComponent(searchValue)}`;
        
        // Make API request with authentication headers
        const fetchOptions = getFetchOptions();
        const response = await fetch(url, fetchOptions);
        const data = await handleApiResponse(response);
        
        // Success: pass results to parent component
        emit('players-found', data);
      } catch (error) {
        // Error: convert to user-friendly message and notify parent
        const friendlyMessage = getErrorMessage(error, 'player search');
        emit('search-error', friendlyMessage);
      } finally {
        // Always reset loading state (even on error)
        isSearching.value = false;
      }
    };

    return {
      searchType,
      searchInput,
      isSearching,
      searchPlaceholder,
      handleSubmit,
      handleInput
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
            :type="searchType === 'bttcid' ? 'tel' : 'text'"
            :inputmode="searchType === 'bttcid' ? 'numeric' : 'text'"
            :pattern="searchType === 'bttcid' ? '[0-9]*' : undefined"
            v-model="searchInput"
            :placeholder="searchPlaceholder"
            required 
            :disabled="isSearching"
            @input="handleInput"
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

/**
 * PlayerResults Component
 * 
 * PURPOSE: Displays the list of players found from search, allowing user to select one
 * 
 * PROPS:
 * - players: Array of player objects from search results
 * - totalFound: Total number of players matching search (may include already signed up)
 * - availableForSignup: Number of players available for signup (not already signed up)
 * 
 * BEHAVIOR:
 * - Shows all players from search results
 * - Only allows clicking on players who haven't signed up yet
 * - Already-signed-up players are grayed out and show a checkmark
 * - Clicking a non-signed-up player emits 'player-selected' event
 */
const PlayerResults = {
  props: {
    players: Array,              // Player objects with: first_name, last_name, bttc_id, already_signed_up
    totalFound: Number,          // Total matches found (includes already signed up)
    availableForSignup: Number   // Count of players available for signup
  },
  emits: ['player-selected'],
  setup(props, { emit }) {
    /**
     * Handles player card click
     * 
     * Only allows selection if player hasn't already signed up.
     * If already signed up, player card is disabled (no action).
     * 
     * @param {object} player - Player object from search results
     */
    const selectPlayer = (player) => {
      // Only emit selection for players who haven't completed signup
      if (!player.already_signed_up) {
        emit('player-selected', player);
      }
      // If already_signed_up is true, do nothing (UI shows it's disabled)
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
        :class="{ 'selected': player.already_signed_up, 'already-signed-up': player.already_signed_up }"
        @click="selectPlayer(player)"
      >
        <div class="player-name">{{ player.first_name }} {{ player.last_name }}</div>
        <div class="player-id">BTTC ID: {{ player.bttc_id }}</div>
        <div v-if="player.already_signed_up" class="player-signed-up">
          ✓ Already signed up
        </div>
      </div>

      <div 
        v-if="totalFound > availableForSignup"
        class="info"
      >
        Found {{ totalFound }} total matches, showing {{ availableForSignup }} available for signup.
      </div>
    </div>
  `
};

// ========================================
// PLAYER DIALOG COMPONENT
// ========================================

/**
 * PlayerDialog Component
 * 
 * PURPOSE: Modal dialog form for completing player profile (phone, email, PIN)
 * 
 * PROPS:
 * - show: Boolean to control modal visibility
 * - player: Selected player object with bttc_id, first_name, last_name
 * 
 * BEHAVIOR:
 * - Displays as overlay modal when show=true
 * - Collects phone number (10 digits), email, and PIN (6 digits)
 * - Validates all fields client-side before submission
 * - Shows validation errors inline below each field
 * - On submit: emits 'submit' event with form data
 * - On cancel/close: emits 'close' event and clears form
 * 
 * VALIDATION RULES:
 * - Phone: Exactly 10 digits (no spaces, dashes, or letters)
 * - Email: Standard email format (user@domain.com)
 * - PIN: Exactly 6 digits (numbers only)
 */
const PlayerDialog = {
  props: {
    show: Boolean,    // Controls dialog visibility
    player: Object    // Selected player info to display in dialog header
  },
  emits: ['close', 'submit'],
  setup(props, { emit }) {
    // Form input state
    const phoneNumber = ref('');
    const email = ref('');
    const userToken = ref('');  // PIN/token input
    
    // Validation error messages (shown below each field)
    const phoneError = ref('');
    const emailError = ref('');
    const tokenError = ref('');
    
    // Loading state during form submission
    const isSubmitting = ref(false);

    /**
     * Validates phone number format
     * Must be exactly 10 digits with no spaces, dashes, or other characters
     * 
     * @param {string} phone - Phone number to validate
     * @returns {boolean} - True if valid 10-digit phone number
     */
    const validatePhone = (phone) => {
      const phoneRegex = /^\d{10}$/;
      return phoneRegex.test(phone);
    };

    /**
     * Validates email address format
     * Basic email validation (user@domain.com format)
     * 
     * @param {string} emailValue - Email to validate
     * @returns {boolean} - True if valid email format
     */
    const validateEmail = (emailValue) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(emailValue);
    };

    /**
     * Validates PIN/token format
     * Must be exactly 6 digits (numbers only)
     * 
     * @param {string} token - PIN to validate
     * @returns {boolean} - True if valid 6-digit PIN
     */
    const validateToken = (token) => {
      const tokenRegex = /^\d{6}$/;
      return tokenRegex.test(token);
    };

    /**
     * Clears all validation error messages
     * Called when user starts typing or when form is reset
     */
    const clearValidationErrors = () => {
      phoneError.value = '';
      emailError.value = '';
      tokenError.value = '';
    };

    /**
     * Handles dialog close/cancel
     * Resets all form fields and validation errors, then emits close event
     */
    const handleClose = () => {
      phoneNumber.value = '';
      email.value = '';
      userToken.value = '';
      clearValidationErrors();
      emit('close');
    };

    /**
     * Handles form submission
     * 
     * FLOW:
     * 1. Clear previous validation errors
     * 2. Trim all input values
     * 3. Validate each field
     * 4. Show validation errors if any field fails
     * 5. If all valid, set loading state and emit 'submit' event
     * 6. Parent component handles actual API call
     */
    const handleSubmit = () => {
      clearValidationErrors();
      let isValid = true;

      // Get trimmed values from form inputs
      const phone = phoneNumber.value.trim();
      const emailValue = email.value.trim();
      const token = userToken.value.trim();

      // Validate phone number
      if (!validatePhone(phone)) {
        phoneError.value = 'Please enter a valid 10-digit phone number';
        isValid = false;
      }

      // Validate email
      if (!validateEmail(emailValue)) {
        emailError.value = 'Please enter a valid email address';
        isValid = false;
      }

      // Validate PIN
      if (!validateToken(token)) {
        tokenError.value = 'PIN must be exactly 6 digits';
        isValid = false;
      }

      // Stop if validation failed (errors are already shown)
      if (!isValid) return;

      // All validation passed, set loading state and emit submit event
      // Parent component will handle the API call
      isSubmitting.value = true;

      emit('submit', {
        phoneNumber: phone,
        email: emailValue,
        token: token,
        // Provide callback to allow parent to reset loading state
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

/**
 * PlayerSignupApp Component
 * 
 * PURPOSE: Main application component that orchestrates the player signup flow
 * 
 * COMPONENT HIERARCHY:
 * PlayerSignupApp (this component)
 *   ├── PlayerSearch (search form)
 *   ├── PlayerResults (search results list)
 *   └── PlayerDialog (signup form modal)
 * 
 * APPLICATION FLOW:
 * 1. Initial state: Shows search form
 * 2. User searches → PlayerSearch emits 'players-found'
 * 3. Results displayed → PlayerResults component shows matching players
 * 4. User clicks player → PlayerResults emits 'player-selected'
 * 5. Dialog opens → PlayerDialog component shows form
 * 6. User submits form → PlayerDialog emits 'submit' with form data
 * 7. API call → POST to /player/signup
 * 8. Success → Shows success message, hides search form, shows link to RR registration
 * 
 * STATE MANAGEMENT:
 * - searchResults: Array of player objects from search
 * - selectedPlayer: Currently selected player (null when dialog closed)
 * - showDialog: Boolean controlling dialog visibility
 * - error/successMessage: User-facing messages
 */
const PlayerSignupApp = {
  components: {
    PlayerSearch,   // Search form component
    PlayerResults, // Results display component
    PlayerDialog   // Signup form modal component
  },
  setup() {
    // Application state
    const searchResults = ref([]);        // Players found from search
    const totalFound = ref(0);             // Total matches (may include already signed up)
    const availableForSignup = ref(0);     // Count of players available for signup
    const selectedPlayer = ref(null);     // Currently selected player for signup
    const showDialog = ref(false);        // Controls dialog modal visibility
    const error = ref('');                // Error message to display
    const successMessage = ref('');        // Success message to display

    /**
     * Handles successful player search results
     * 
     * CALLED BY: PlayerSearch component emits 'players-found' event
     * 
     * FLOW:
     * 1. Clear any previous errors/success messages
     * 2. Check if API returned an error in data.error
     * 3. Check if no players found (but distinguish between "no matches" vs "all already signed up")
     * 4. Set search results and counts if players found
     * 
     * @param {object} data - API response with players array, total_found, available_for_signup
     */
    const handlePlayersFound = (data) => {
      // Clear previous messages
      error.value = '';
      successMessage.value = '';

      // Check for explicit error from API
      if (data.error) {
        error.value = data.error;
        searchResults.value = [];
        return;
      }

      // Handle case where search found no players
      if (!data.players || data.players.length === 0) {
        // Get support contact information from ENV
        const supportPhone = typeof ENV !== 'undefined' ? ENV.SUPPORT_PHONE : '510-926-6913';
        const supportMethod = typeof ENV !== 'undefined' ? ENV.SUPPORT_METHOD : 'TEXT ONLY';
        
        // Distinguish between "no matches" and "all matches already signed up"
        if (data.total_found > 0 && data.available_for_signup === 0) {
          // Found players but they've all completed signup
          error.value = `Found players matching your search, but they have already completed their signup. If this is incorrect, please contact BTTC support at ${supportPhone} (${supportMethod})`;
        } else {
          // No players found matching search
          error.value = `No players found. Please check your spelling or contact BTTC support at ${supportPhone} (${supportMethod})`;
        }
        searchResults.value = [];
        return;
      }

      // Success: set search results and display in PlayerResults component
      searchResults.value = data.players;
      totalFound.value = data.total_found || data.players.length;
      availableForSignup.value = data.available_for_signup || data.players.filter(p => !p.already_signed_up).length;
    };

    /**
     * Handles search errors
     * 
     * CALLED BY: PlayerSearch component emits 'search-error' event
     * 
     * @param {string} errorMessage - User-friendly error message from PlayerSearch
     */
    const handleSearchError = (errorMessage) => {
      error.value = errorMessage;
      successMessage.value = '';
      searchResults.value = [];
    };

    /**
     * Handles player selection from results list
     * 
     * CALLED BY: PlayerResults component emits 'player-selected' event when user clicks a player
     * 
     * FLOW:
     * 1. Store selected player
     * 2. Open dialog modal to show signup form
     * 
     * @param {object} player - Selected player object
     */
    const handlePlayerSelected = (player) => {
      selectedPlayer.value = player;
      showDialog.value = true;
    };

    /**
     * Handles dialog close/cancel
     * 
     * CALLED BY: PlayerDialog component emits 'close' event
     * 
     * Clears selected player and closes dialog
     */
    const handleDialogClose = () => {
      showDialog.value = false;
      selectedPlayer.value = null;
    };

    /**
     * Handles dialog form submission
     * 
     * CALLED BY: PlayerDialog component emits 'submit' event with form data
     * 
     * FLOW:
     * 1. Build payload with player info and form data (phone, email, PIN)
     * 2. POST to /player/signup API endpoint
     * 3. On success: Show success message, hide search form, close dialog
     * 4. On error: Show alert with error message
     * 5. Always: Reset submitting state via callback
     * 
     * @param {object} formData - Object with phoneNumber, email, token, setSubmitting callback
     */
    const handleDialogSubmit = async (formData) => {
      const { phoneNumber, email, token, setSubmitting } = formData;

      // Build API payload with player info and form data
      const payload = {
        bttc_id: selectedPlayer.value.bttc_id,
        first_name: selectedPlayer.value.first_name,
        last_name: selectedPlayer.value.last_name,
        phone_number: phoneNumber,
        email: email,
        token: token  // 6-digit PIN
      };

      try {
        // Make API call to complete player signup
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const url = `${apiUrl}/player/signup`;

        const fetchOptions = getFetchOptions({
          method: 'POST',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const response = await fetch(url, fetchOptions);
        const data = await handleApiResponse(response);

        // Check API response
        if (data.success) {
          // Success: Show success message and hide search form
          // User will only see success message and link to RR registration
          successMessage.value = 'Registration completed successfully! You can now use your phone number to register for round robin events.';
          error.value = '';
          searchResults.value = [];
          showDialog.value = false;
          selectedPlayer.value = null;
        } else {
          // API returned error (e.g., phone number already in use)
          alert('Registration failed: ' + (data.message || 'Unknown error'));
        }
      } catch (err) {
        // Network error or other exception
        const friendlyMessage = getErrorMessage(err, 'registration');
        alert('Registration failed: ' + friendlyMessage);
      } finally {
        // Always reset submitting state (re-enable form)
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

