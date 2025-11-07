// BTTC Player Signup
// Utilities loaded from bttc-utils.js: getErrorMessage, getFetchOptions, handleApiResponse, validatePhone, validateEmail, validateToken, formatPhoneNumber

const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

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

    const handleInput = (e) => {
      if (searchType.value === 'bttcid') {
        // Remove any non-numeric characters
        const numericOnly = e.target.value.replace(/\D/g, '');
        searchInput.value = numericOnly;
      }
    };

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
      <p class="subtitle">Find yourself in our system and complete your player signup</p>
      
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


const PlayerResults = {
  props: {
    players: Array,              // Player objects with: first_name, last_name, bttc_id, already_signed_up
    totalFound: Number,          // Total matches found (includes already signed up)
    availableForSignup: Number   // Count of players available for signup
  },
  emits: ['player-selected'],
  setup(props, { emit }) {
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
      <div class="info">Click on your name to complete your player signup:</div>
      
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

    const filterNumericInput = (e, fieldName) => {
      // Get current value and remove any non-numeric characters
      const numericOnly = e.target.value.replace(/\D/g, '');
      
      // Update the field with numeric-only value
      if (fieldName === 'token') {
        userToken.value = numericOnly.slice(0, 6);  // Limit to 6 digits
      } else if (fieldName === 'phone') {
        // Format phone number using shared utility (xxx-xxx-xxxx)
        phoneNumber.value = formatPhoneNumber(numericOnly);
      }
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

      // Get trimmed values from form inputs
      const phone = phoneNumber.value.trim();
      const emailValue = email.value.trim();
      const token = userToken.value.trim();

      // Validate phone number
      const phoneValidation = validatePhone(phone);
      if (!phoneValidation.valid) {
        phoneError.value = phoneValidation.message || 'Please enter a valid 10-digit phone number';
        isValid = false;
      }

      // Validate email (only if provided, since it's optional)
      if (emailValue) {
        const emailValidation = validateEmail(emailValue);
        if (!emailValidation.valid) {
          emailError.value = emailValidation.message || 'Please enter a valid email address';
          isValid = false;
        }
      }

      // Validate PIN
      const tokenValidation = validateToken(token);
      if (!tokenValidation.valid) {
        tokenError.value = tokenValidation.message || 'PIN must be exactly 6 digits';
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
      filterNumericInput,
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
            <div class="phone-input-wrapper">
              <span class="country-code">+1</span>
              <input 
                type="tel" 
                id="phoneNumber"
                v-model="phoneNumber"
                placeholder="xxx-xxx-xxxx"
                maxlength="12"
                inputmode="numeric"
                pattern="[0-9-]*"
                required 
                :disabled="isSubmitting"
                @input="filterNumericInput($event, 'phone')"
              />
            </div>
            <div class="help-text">Enter 10-digit US phone number</div>
            <div v-if="phoneError" class="validation-error">{{ phoneError }}</div>
          </div>

          <div class="form-group">
            <label for="email">Email Address (optional)</label>
            <input 
              type="email" 
              id="email"
              v-model="email"
              placeholder="e.g., john@example.com" 
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
                inputmode="numeric"
                pattern="[0-9]*"
                required 
                :disabled="isSubmitting"
                @input="filterNumericInput($event, 'token')"
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

    const handleSearchError = (errorMessage) => {
      error.value = errorMessage;
      successMessage.value = '';
      searchResults.value = [];
    };

    const handlePlayerSelected = (player) => {
      selectedPlayer.value = player;
      showDialog.value = true;
    };

    const handleDialogClose = () => {
      showDialog.value = false;
      selectedPlayer.value = null;
    };

    const handleDialogSubmit = async (formData) => {
      const { phoneNumber, email, token, setSubmitting } = formData;

      // Strip dashes from phone number for backend (backend expects digits only)
      const cleanedPhone = phoneNumber.replace(/\D/g, '');

      // Build API payload with player info and form data
      const payload = {
        bttc_id: selectedPlayer.value.bttc_id,
        first_name: selectedPlayer.value.first_name,
        last_name: selectedPlayer.value.last_name,
        phone_number: cleanedPhone,  // Send digits only (e.g., 8122721164)
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
          successMessage.value = 'Signup completed successfully! You can now use your phone number to register for round robin events.';
          error.value = '';
          searchResults.value = [];
          showDialog.value = false;
          selectedPlayer.value = null;
        } else {
          // API returned error (e.g., phone number already in use)
          alert('Signup failed: ' + (data.message || 'Unknown error'));
        }
      } catch (err) {
        // Network error or other exception
        const friendlyMessage = getErrorMessage(err, 'signup');
        alert('Signup failed: ' + friendlyMessage);
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
      <a v-if="!successMessage" href="bttc_rr_registration_vue.html" class="back-link">← Back to Round Robin Registration</a>
      
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

