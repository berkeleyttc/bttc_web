// BTTC Player Signup
// Utilities loaded from bttc-utils.js: getErrorMessage, getFetchOptions, handleApiResponse, validatePhone, validateEmail, validateToken, formatPhoneNumber

const { createApp, ref, reactive, computed, onMounted, nextTick, watch } = Vue;

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

    // Clear search input when switching between search types
    watch(searchType, () => {
      searchInput.value = '';
    });

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
      <p class="subtitle">Returning players find yourself in our system and complete your player signup</p>
      
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
    </div>
  `
};

const PlayerDialog = {
  props: {
    show: Boolean,    // Controls dialog visibility
    player: Object,   // Selected player info to display in dialog header
    successMessage: String,  // Success message to display inline
    errorMessage: String     // Error message to display inline
  },
  emits: ['close', 'submit'],
  setup(props, { emit }) {
    // Form input state
    const phoneNumber = ref('');
    const email = ref('');
    
    // Validation error messages (shown below each field)
    const phoneError = ref('');
    const emailError = ref('');
    
    // Loading state during form submission
    const isSubmitting = ref(false);

    const filterNumericInput = (e, fieldName) => {
      // Get current value and remove any non-numeric characters
      const numericOnly = e.target.value.replace(/\D/g, '');
      
      // Update the field with numeric-only value
      if (fieldName === 'phone') {
        // Format phone number using shared utility (xxx-xxx-xxxx)
        phoneNumber.value = formatPhoneNumber(numericOnly);
      }
    };

    const clearValidationErrors = () => {
      phoneError.value = '';
      emailError.value = '';
    };

    const handleClose = () => {
      phoneNumber.value = '';
      email.value = '';
      clearValidationErrors();
      emit('close');
    };

    // Watch for dialog opening and reset form fields
    watch(() => props.show, (newValue) => {
      if (newValue) {
        phoneNumber.value = '';
        email.value = '';
        clearValidationErrors();
      }
    });

    const handleSubmit = () => {
      clearValidationErrors();
      let isValid = true;

      // Get trimmed values from form inputs
      const phone = phoneNumber.value.trim();
      const emailValue = email.value.trim();

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

      // Stop if validation failed (errors are already shown)
      if (!isValid) return;

      // All validation passed, set loading state and emit submit event
      // Parent component will handle the API call
      isSubmitting.value = true;

      emit('submit', {
        phoneNumber: phone,
        email: emailValue,
        // Provide callback to allow parent to reset loading state
        setSubmitting: (value) => { isSubmitting.value = value; }
      });
    };

    return {
      phoneNumber,
      email,
      phoneError,
      emailError,
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

        <!-- Success Message -->
        <div v-if="successMessage" class="dialog-message dialog-message-success">
          <span class="message-icon">✓</span>
          <div class="message-text">
            <div>{{ successMessage }}</div>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="errorMessage" class="dialog-message dialog-message-error">
          <span class="message-icon">✗</span>
          <span class="message-text">{{ errorMessage }}</span>
        </div>

        <form v-if="!successMessage" @submit.prevent="handleSubmit">
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

          <div class="dialog-buttons">
            <button 
              v-if="!successMessage"
              type="button" 
              class="dialog-btn dialog-btn-secondary" 
              @click="handleClose"
              :disabled="isSubmitting"
            >
              Cancel
            </button>
            <button 
              v-if="!successMessage"
              type="submit" 
              class="dialog-btn dialog-btn-primary"
              :disabled="isSubmitting"
            >
              <span v-if="!isSubmitting">Complete Player Signup</span>
              <span v-else>Submitting...</span>
            </button>
          </div>
        </form>

        <!-- Close button for success state -->
        <div v-if="successMessage" class="dialog-buttons">
          <button 
            type="button" 
            class="dialog-btn dialog-btn-primary" 
            @click="handleClose"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  `
};

const NewPlayerForm = {
  emits: ['new-player-submit', 'form-error'],
  setup(props, { emit }) {
    // Multi-step state
    const currentStep = ref(1); // 1 = Basic Info, 2 = Rating Method, 3 = Survey/Rating Input
    const totalSteps = 3;

    // Step 1: Basic info form state
    const firstName = ref('');
    const lastName = ref('');
    const phoneNumber = ref('');
    const email = ref('');
    
    // Step 2: Rating method selection
    const ratingMethod = ref(''); // 'novice', 'survey', or 'has_rating'
    
    // Step 3a: Manual rating input (if has_rating)
    const manualRating = ref('');
    
    // Step 3b: Survey responses (if survey)
    const surveyA = ref(''); // Playing Experience
    const surveyB = ref(''); // Rally & Consistency
    const surveyC = ref(''); // Spin & Serves
    const surveyD = ref(''); // Receive & Tactics
    const surveyE = ref(''); // Footwork & Match Play
    const surveyF = ref(false); // Loop forehand
    const surveyG = ref(false); // Loop backhand
    const surveyH = ref(false); // Counter-loop
    const surveyI = ref(false); // Chop defense
    
    // Validation and submission
    const isSubmitting = ref(false);
    const firstNameError = ref('');
    const lastNameError = ref('');
    const phoneError = ref('');
    const emailError = ref('');
    const ratingMethodError = ref('');
    const manualRatingError = ref('');
    const surveyError = ref('');

    const filterPhoneInput = (e) => {
      const numericOnly = e.target.value.replace(/\D/g, '');
      phoneNumber.value = formatPhoneNumber(numericOnly);
    };

    const clearValidationErrors = () => {
      firstNameError.value = '';
      lastNameError.value = '';
      phoneError.value = '';
      emailError.value = '';
      ratingMethodError.value = '';
      manualRatingError.value = '';
      surveyError.value = '';
    };

    // Step 1: Validate basic info
    const validateStep1 = () => {
      clearValidationErrors();
      let isValid = true;

      const firstNameTrimmed = firstName.value.trim();
      if (!firstNameTrimmed) {
        firstNameError.value = 'First name is required';
        isValid = false;
      }

      const lastNameTrimmed = lastName.value.trim();
      if (!lastNameTrimmed) {
        lastNameError.value = 'Last name is required';
        isValid = false;
      }

      const phone = phoneNumber.value.trim();
      const phoneValidation = validatePhone(phone);
      if (!phoneValidation.valid) {
        phoneError.value = phoneValidation.message || 'Please enter a valid 10-digit phone number';
        isValid = false;
      }

      const emailValue = email.value.trim();
      if (emailValue) {
        const emailValidation = validateEmail(emailValue);
        if (!emailValidation.valid) {
          emailError.value = emailValidation.message || 'Please enter a valid email address';
          isValid = false;
        }
      }

      return isValid;
    };

    // Step 2: Validate rating method selection
    const validateStep2 = () => {
      clearValidationErrors();
      
      if (!ratingMethod.value) {
        ratingMethodError.value = 'Please select an option';
        return false;
      }
      
      return true;
    };

    // Step 3: Validate based on rating method
    const validateStep3 = () => {
      clearValidationErrors();
      
      if (ratingMethod.value === 'novice') {
        // No validation needed, auto-assign 100
        return true;
      } else if (ratingMethod.value === 'has_rating') {
        // Validate manual rating input
        const rating = manualRating.value.trim();
        if (!rating) {
          manualRatingError.value = 'Please enter your rating';
          return false;
        }
        const ratingNum = parseInt(rating, 10);
        if (isNaN(ratingNum) || ratingNum < 0 || ratingNum > 3500) {
          manualRatingError.value = 'Please enter a valid rating between 0 and 3500';
          return false;
        }
        return true;
      } else if (ratingMethod.value === 'survey') {
        // Validate survey questions
        if (!surveyA.value || !surveyB.value || !surveyC.value || !surveyD.value || !surveyE.value) {
          surveyError.value = 'Please answer all required questions (A-E)';
          return false;
        }
        return true;
      }
      
      return false;
    };

    const handleNext = () => {
      if (currentStep.value === 1) {
        if (validateStep1()) {
          currentStep.value = 2;
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else if (currentStep.value === 2) {
        if (validateStep2()) {
          currentStep.value = 3;
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    };

    const handleBack = () => {
      if (currentStep.value > 1) {
        currentStep.value--;
        clearValidationErrors();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    const handleSubmit = (e) => {
      e.preventDefault();
      
      // Final validation
      if (!validateStep1() || !validateStep2() || !validateStep3()) {
        return;
      }

      isSubmitting.value = true;

      // Build payload based on rating method
      const payload = {
        firstName: firstName.value.trim(),
        lastName: lastName.value.trim(),
        phoneNumber: phoneNumber.value.trim(),
        email: email.value.trim(),
        setSubmitting: (value) => { isSubmitting.value = value; }
      };

      if (ratingMethod.value === 'novice') {
        // Novice player: auto-assign rating 100
        payload.rating = 100;
      } else if (ratingMethod.value === 'has_rating') {
        // Has rating: use manual input
        payload.rating = parseInt(manualRating.value.trim(), 10);
      } else if (ratingMethod.value === 'survey') {
        // Survey: send survey responses
        payload.ratingSurvey = {
          a: surveyA.value,
          b: surveyB.value,
          c: surveyC.value,
          d: surveyD.value,
          e: surveyE.value,
          f: surveyF.value,
          g: surveyG.value,
          h: surveyH.value,
          i: surveyI.value
        };
      }

      // Emit submit event with payload
      emit('new-player-submit', payload);
    };

    // Computed: Dynamic step 3 label based on rating method
    const step3Label = computed(() => {
      if (ratingMethod.value === 'survey') return 'Skill Survey';
      if (ratingMethod.value === 'has_rating') return 'Enter Rating';
      if (ratingMethod.value === 'novice') return 'Confirm';
      return 'Details';
    });

    return {
      currentStep,
      totalSteps,
      firstName,
      lastName,
      phoneNumber,
      email,
      ratingMethod,
      manualRating,
      surveyA,
      surveyB,
      surveyC,
      surveyD,
      surveyE,
      surveyF,
      surveyG,
      surveyH,
      surveyI,
      isSubmitting,
      firstNameError,
      lastNameError,
      phoneError,
      emailError,
      ratingMethodError,
      manualRatingError,
      surveyError,
      step3Label,
      filterPhoneInput,
      handleNext,
      handleBack,
      handleSubmit
    };
  },
  template: `
    <div>
      <h1>Sign Up as New Player</h1>
      <p class="subtitle">Create your account to register for Round Robin events</p>
      
      <!-- Progress Indicator -->
      <div class="step-progress">
        <div class="step" :class="{ 'active': currentStep === 1, 'completed': currentStep > 1 }">
          <div class="step-number">1</div>
          <div class="step-label">Basic Info</div>
        </div>
        <div class="step-divider"></div>
        <div class="step" :class="{ 'active': currentStep === 2, 'completed': currentStep > 2 }">
          <div class="step-number">2</div>
          <div class="step-label">Experience</div>
        </div>
        <div class="step-divider"></div>
        <div class="step" :class="{ 'active': currentStep === 3 }">
          <div class="step-number">3</div>
          <div class="step-label">{{ step3Label }}</div>
        </div>
      </div>

      <form @submit.prevent="handleSubmit">
        <!-- Step 1: Basic Information -->
        <div v-show="currentStep === 1" class="form-step">
          <div class="form-group">
            <label for="firstName">First Name *</label>
            <input 
              type="text" 
              id="firstName"
              v-model="firstName"
              placeholder="Enter your first name"
              required 
              :disabled="isSubmitting"
            />
            <div v-if="firstNameError" class="validation-error">{{ firstNameError }}</div>
          </div>

          <div class="form-group">
            <label for="lastName">Last Name *</label>
            <input 
              type="text" 
              id="lastName"
              v-model="lastName"
              placeholder="Enter your last name"
              required 
              :disabled="isSubmitting"
            />
            <div v-if="lastNameError" class="validation-error">{{ lastNameError }}</div>
          </div>

          <div class="form-group">
            <label for="newPlayerPhone">Phone Number *</label>
            <div class="phone-input-wrapper">
              <span class="country-code">+1</span>
              <input 
                type="tel" 
                id="newPlayerPhone"
                v-model="phoneNumber"
                placeholder="xxx-xxx-xxxx"
                maxlength="12"
                inputmode="numeric"
                pattern="[0-9-]*"
                required 
                :disabled="isSubmitting"
                @input="filterPhoneInput"
              />
            </div>
            <div class="help-text">Enter 10-digit US phone number</div>
            <div v-if="phoneError" class="validation-error">{{ phoneError }}</div>
          </div>

          <div class="form-group">
            <label for="newPlayerEmail">Email Address (optional)</label>
            <input 
              type="email" 
              id="newPlayerEmail"
              v-model="email"
              placeholder="e.g., john@example.com" 
              :disabled="isSubmitting"
            />
            <div v-if="emailError" class="validation-error">{{ emailError }}</div>
          </div>

          <button type="button" @click="handleNext" class="btn-next">
            Next: Experience Level →
          </button>
        </div>

        <!-- Step 2: Rating Method Selection -->
        <div v-show="currentStep === 2" class="form-step">
          <div class="survey-intro">
            <p><strong>Tell us about your table tennis experience</strong></p>
            <p class="help-text">This helps us assign you an appropriate starting rating.</p>
          </div>

          <div v-if="ratingMethodError" class="validation-error" style="margin-bottom: 1rem;">{{ ratingMethodError }}</div>

          <div class="rating-method-options">
            <label class="rating-method-option">
              <input type="radio" name="ratingMethod" value="novice" v-model="ratingMethod" />
              <div class="option-content">
                <div class="option-title">I am a novice player, just starting out</div>
                <div class="option-description">You'll be assigned a starting rating of 100</div>
              </div>
            </label>

            <label class="rating-method-option">
              <input type="radio" name="ratingMethod" value="survey" v-model="ratingMethod" />
              <div class="option-content">
                <div class="option-title">I have played before, but don't have/don't know my rating</div>
                <div class="option-description">We'll ask you a few questions to estimate your skill level</div>
              </div>
            </label>

            <label class="rating-method-option">
              <input type="radio" name="ratingMethod" value="has_rating" v-model="ratingMethod" />
              <div class="option-content">
                <div class="option-title">I have played at other clubs/leagues/tournaments and have a rating</div>
                <div class="option-description">You can enter your existing USATT or club rating</div>
              </div>
            </label>
          </div>

          <div class="form-buttons">
            <button type="button" @click="handleBack" class="btn-back" :disabled="isSubmitting">
              ← Back
            </button>
            <button type="button" @click="handleNext" class="btn-next" :disabled="!ratingMethod">
              Next →
            </button>
          </div>
        </div>

        <!-- Step 3: Dynamic Content Based on Rating Method -->
        <div v-show="currentStep === 3" class="form-step">
          
          <!-- Option 1: Novice Player (auto-assign 100) -->
          <div v-if="ratingMethod === 'novice'" class="novice-confirmation">
            <div class="confirmation-box">
              <div class="confirmation-icon">✓</div>
              <h3>Welcome to BTTC!</h3>
              <p>You'll be assigned a starting rating of <strong>100</strong>.</p>
              <p class="help-text">Your rating will be adjusted as you play matches and participate in events.</p>
            </div>

            <div class="form-buttons">
              <button type="button" @click="handleBack" class="btn-back" :disabled="isSubmitting">
                ← Back
              </button>
              <button type="submit" :disabled="isSubmitting" class="btn-submit">
                <span v-if="!isSubmitting">Create Account</span>
                <span v-else>Creating Account<span class="loading-spinner"></span></span>
              </button>
            </div>
          </div>

          <!-- Option 2: Has Rating (manual input) -->
          <div v-if="ratingMethod === 'has_rating'" class="manual-rating-input">
            <div class="survey-intro">
              <p><strong>Enter Your Rating</strong></p>
              <p class="help-text">Enter your USATT rating or club rating from your previous league/club.</p>
            </div>

            <div class="form-group">
              <label for="manualRating">Your Rating *</label>
              <input 
                type="number" 
                id="manualRating"
                v-model="manualRating"
                placeholder="e.g., 1500"
                min="0"
                max="3500"
                step="1"
                required 
                :disabled="isSubmitting"
              />
              <div class="help-text">Enter a rating between 0 and 3500</div>
              <div v-if="manualRatingError" class="validation-error">{{ manualRatingError }}</div>
            </div>

            <div class="info">
              <strong>Don't know your exact rating?</strong> Enter your best estimate, or go back and take the skill survey instead.
            </div>

            <div class="form-buttons">
              <button type="button" @click="handleBack" class="btn-back" :disabled="isSubmitting">
                ← Back
              </button>
              <button type="submit" :disabled="isSubmitting" class="btn-submit">
                <span v-if="!isSubmitting">Create Account</span>
                <span v-else>Creating Account<span class="loading-spinner"></span></span>
              </button>
            </div>
          </div>

          <!-- Option 3: Survey (existing survey content) -->
          <div v-if="ratingMethod === 'survey'" class="survey-content">
          <div class="survey-intro">
            <p><strong>Help us understand your skill level</strong></p>
            <p class="help-text">For each question, select the highest statement that's fully true for you.</p>
          </div>

          <div v-if="surveyError" class="validation-error" style="margin-bottom: 1rem;">{{ surveyError }}</div>

          <!-- Question A -->
          <div class="survey-question">
            <h3>A. Playing Experience & Results</h3>
            <label class="radio-option">
              <input type="radio" name="surveyA" value="A0" v-model="surveyA" />
              <span>I mostly play casually with friends/family; I've never played in a club or league.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyA" value="A1" v-model="surveyA" />
              <span>I occasionally play at clubs or meetups, but I rarely keep score seriously.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyA" value="A2" v-model="surveyA" />
              <span>I regularly play in club sessions or leagues and usually win some and lose some.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyA" value="A3" v-model="surveyA" />
              <span>I frequently play in leagues or tournaments and usually finish in the top half (or better) of my group.</span>
            </label>
          </div>

          <!-- Question B -->
          <div class="survey-question">
            <h3>B. Rally & Consistency</h3>
            <label class="radio-option">
              <input type="radio" name="surveyB" value="B0" v-model="surveyB" />
              <span>I struggle to keep more than a few balls on the table in a rally.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyB" value="B1" v-model="surveyB" />
              <span>I can keep a rally going at a controlled pace on both forehand and backhand if my opponent isn't attacking.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyB" value="B2" v-model="surveyB" />
              <span>I can reliably rally on both wings, change direction (cross-court/down-the-line), and keep 10+ balls on the table in a cooperative drill.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyB" value="B3" v-model="surveyB" />
              <span>I can rally at high speed with consistency, including counters and blocks against moderate attacks.</span>
            </label>
          </div>

          <!-- Question C -->
          <div class="survey-question">
            <h3>C. Spin & Serves</h3>
            <label class="radio-option">
              <input type="radio" name="surveyC" value="C0" v-model="surveyC" />
              <span>My serves are mostly flat; I don't really control spin.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyC" value="C1" v-model="surveyC" />
              <span>I can put some topspin or backspin on my serves, but it doesn't vary much.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyC" value="C2" v-model="surveyC" />
              <span>I use spinny serves (topspin, backspin, sidespin), can serve short or long, and can aim to different parts of the table.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyC" value="C3" v-model="surveyC" />
              <span>I use advanced serves (e.g. pendulum, reverse, hook, heavy backspin/side) with good disguise and placement, and I often win points or weak returns from my serve.</span>
            </label>
          </div>

          <!-- Question D -->
          <div class="survey-question">
            <h3>D. Receive, Spin Handling & Tactics</h3>
            <label class="radio-option">
              <input type="radio" name="surveyD" value="D0" v-model="surveyD" />
              <span>I find it very difficult to return spin serves or spinny shots; many of my returns go long or into the net.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyD" value="D1" v-model="surveyD" />
              <span>I can usually return simple spin serves, but heavy spin often causes errors.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyD" value="D2" v-model="surveyD" />
              <span>I can read and handle most spins (top, back, side) on serve and during rallies, and I can choose between safe and aggressive returns.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyD" value="D3" v-model="surveyD" />
              <span>I can consistently read complex or disguised spin, vary my receive (push, flick, loop, drop shot), and use tactics (placement, tempo changes) to set up my own attack.</span>
            </label>
          </div>

          <!-- Question E -->
          <div class="survey-question">
            <h3>E. Footwork & Match Play</h3>
            <label class="radio-option">
              <input type="radio" name="surveyE" value="E0" v-model="surveyE" />
              <span>I mostly stand in one spot; I often get caught reaching or out of position.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyE" value="E1" v-model="surveyE" />
              <span>I can move a bit to reach balls but have trouble recovering for the next shot.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyE" value="E2" v-model="surveyE" />
              <span>I move reasonably well side-to-side, can adjust my distance from the table, and can play multiple balls while moving.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="surveyE" value="E3" v-model="surveyE" />
              <span>I anticipate shots well, move efficiently, and can maintain good positioning during fast rallies and wide angles.</span>
            </label>
          </div>

          <!-- Optional Skills -->
          <div class="survey-question optional-section">
            <h3>Optional: "Skill Check" Extras</h3>
            <p class="help-text">Check all that apply:</p>
            
            <label class="checkbox-option">
              <input type="checkbox" v-model="surveyF" />
              <span>F. I can loop a strong backspin ball consistently on my forehand.</span>
            </label>
            <label class="checkbox-option">
              <input type="checkbox" v-model="surveyG" />
              <span>G. I can loop a strong backspin ball consistently on my backhand.</span>
            </label>
            <label class="checkbox-option">
              <input type="checkbox" v-model="surveyH" />
              <span>H. I can counter-loop against a topspin ball away from the table.</span>
            </label>
            <label class="checkbox-option">
              <input type="checkbox" v-model="surveyI" />
              <span>I. I can effectively chop (defensive backspin) from mid or far distance.</span>
            </label>
          </div>

            <div class="form-buttons">
              <button type="button" @click="handleBack" class="btn-back" :disabled="isSubmitting">
                ← Back
              </button>
              <button type="submit" :disabled="isSubmitting" class="btn-submit">
                <span v-if="!isSubmitting">Create Account</span>
                <span v-else>Creating Account<span class="loading-spinner"></span></span>
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  `
};

const PlayerSignupApp = {
  components: {
    PlayerSearch,   // Search form component
    PlayerResults, // Results display component
    PlayerDialog,   // Signup form modal component
    NewPlayerForm   // New player signup form
  },
  setup() {
    // Application state
    const signupMode = ref('returning');   // 'returning' or 'new'
    const searchResults = ref([]);        // Players found from search
    const totalFound = ref(0);             // Total matches (may include already signed up)
    const availableForSignup = ref(0);     // Count of players available for signup
    const selectedPlayer = ref(null);     // Currently selected player for signup
    const showDialog = ref(false);        // Controls dialog modal visibility
    const error = ref('');                // Error message to display
    const successMessage = ref('');        // Success message to display
    const dialogSuccessMessage = ref('');  // Success message for dialog
    const dialogErrorMessage = ref('');    // Error message for dialog

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
          error.value = `No players found. If this seems wrong or you are new to Friday Night League, contact BTTC support at ${supportPhone} (${supportMethod})`;
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
      // Clear any previous dialog messages
      dialogSuccessMessage.value = '';
      dialogErrorMessage.value = '';
      showDialog.value = true;
    };

    const handleDialogClose = () => {
      // Check if there was a successful signup before clearing messages
      const wasSuccessful = !!dialogSuccessMessage.value;
      
      showDialog.value = false;
      selectedPlayer.value = null;
      // Clear dialog messages when closing
      dialogSuccessMessage.value = '';
      dialogErrorMessage.value = '';
      
      // Redirect to Round Robin Registration page after successful signup
      if (wasSuccessful) {
        window.location.href = '../registration/';
      }
    };

    const handleDialogSubmit = async (formData) => {
      const { phoneNumber, email, setSubmitting } = formData;

      // Clear any previous dialog messages
      dialogSuccessMessage.value = '';
      dialogErrorMessage.value = '';

      // Strip dashes from phone number for backend (backend expects digits only)
      const cleanedPhone = phoneNumber.replace(/\D/g, '');

      // Build API payload with player info and form data
      const payload = {
        bttc_id: selectedPlayer.value.bttc_id,
        first_name: selectedPlayer.value.first_name,
        last_name: selectedPlayer.value.last_name,
        phone_number: cleanedPhone,  // Send digits only (e.g., 8122721164)
        email: email
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
          // Success: Show success message inline in dialog
          dialogSuccessMessage.value = 'Signup completed successfully!';
          // Don't close dialog - let user see success message and click Close
        } else {
          // API returned error (e.g., phone number already in use)
          dialogErrorMessage.value = data.message || 'Signup failed. Please try again.';
        }
      } catch (err) {
        // Network error or other exception
        const friendlyMessage = getErrorMessage(err, 'signup');
        dialogErrorMessage.value = friendlyMessage;
      } finally {
        // Always reset submitting state (re-enable form)
        setSubmitting(false);
      }
    };

    /**
     * Handles new player signup submission (brand new players)
     * Creates a new player record in the system
     */
    const handleNewPlayerSubmit = async (formData) => {
      const { firstName, lastName, phoneNumber, email, rating, ratingSurvey, setSubmitting } = formData;

      // Clear any previous messages
      error.value = '';
      successMessage.value = '';

      // Strip dashes from phone number for backend
      const cleanedPhone = phoneNumber.replace(/\D/g, '');

      // Build API payload for new player
      const payload = {
        first_name: firstName,
        last_name: lastName,
        phone_number: cleanedPhone,
        email: email
        // Note: No bttc_id since this is a brand new player
        // Backend will assign internal_user_id
      };

      // Add rating data based on what was provided
      if (rating !== undefined) {
        // Novice (100) or manual rating entry
        payload.rating = rating;
      } else if (ratingSurvey !== undefined) {
        // Survey responses
        payload.rating_survey = ratingSurvey;
      }

      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
        const url = `${apiUrl}/player/signup`;

        const fetchOptions = getFetchOptions({
          method: 'POST',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const response = await fetch(url, fetchOptions);
        const data = await handleApiResponse(response);

        if (data.success) {
          // Success: Show success message and prompt to register
          successMessage.value = `Account created successfully! Welcome, ${firstName}!`;
        } else {
          // API returned error
          error.value = data.message || 'Account creation failed. Please try again.';
        }
      } catch (err) {
        const friendlyMessage = getErrorMessage(err, 'account creation');
        error.value = friendlyMessage;
      } finally {
        setSubmitting(false);
      }
    };

    const handleFormError = (errorMessage) => {
      error.value = errorMessage;
      successMessage.value = '';
    };

    return {
      signupMode,
      searchResults,
      totalFound,
      availableForSignup,
      selectedPlayer,
      showDialog,
      error,
      successMessage,
      dialogSuccessMessage,
      dialogErrorMessage,
      handlePlayersFound,
      handleSearchError,
      handlePlayerSelected,
      handleDialogClose,
      handleDialogSubmit,
      handleNewPlayerSubmit,
      handleFormError
    };
  },
  template: `
    <div class="container">
      <a v-if="!successMessage" href="../registration/" class="back-link">← Back to Round Robin Registration</a>
      
      <div v-if="successMessage">
        <div class="success">
          {{ successMessage }}
        </div>
        <a href="../registration/" class="registration-link-button">
          <span class="registration-link-button-text">→ Go to Round Robin Registration</span>
          <span class="registration-link-button-subtext">Register for the next round robin event</span>
        </a>
      </div>

      <template v-else>
        <!-- Mode selector -->
        <div class="search-type" style="margin-bottom: 2rem;">
          <label>
            <input type="radio" v-model="signupMode" value="returning" /> Returning Player
          </label>
          <label>
            <input type="radio" v-model="signupMode" value="new" /> New Player
          </label>
        </div>

        <!-- Returning player flow -->
        <template v-if="signupMode === 'returning'">
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

        <!-- New player flow -->
        <template v-if="signupMode === 'new'">
          <new-player-form
            @new-player-submit="handleNewPlayerSubmit"
            @form-error="handleFormError"
          />

          <div v-if="error" class="result">
            <div class="error">{{ error }}</div>
          </div>
        </template>
      </template>

      <player-dialog 
        :show="showDialog"
        :player="selectedPlayer"
        :success-message="dialogSuccessMessage"
        :error-message="dialogErrorMessage"
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

