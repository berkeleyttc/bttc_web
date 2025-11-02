/**
 * BTTC Round Robin Roster - Vue.js
 * 
 * Simple and elegant roster display with easy-to-debug code.
 * All functions include console.debug/warn/error logging for debugging.
 * 
 * @file js/roster-vue.js
 */

const { createApp, ref, reactive, computed, onMounted } = Vue;

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
  console.debug('[ErrorHandler] Processing error:', { error, context });
  
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
    console.warn('[ErrorHandler] Network error detected');
    const supportContact = typeof ENV !== 'undefined' 
      ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
      : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
    return `Unable to connect to the server. The roster service may be temporarily unavailable. Please try again in a few moments or ${supportContact}.`;
  }
  
  // HTTP response errors
  if (error && error.response) {
    const status = error.response.status;
    console.debug('[ErrorHandler] HTTP error:', status);
    
    const supportContact = typeof ENV !== 'undefined' 
      ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
      : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
    
    if (status === 0) {
      return `Connection error: The server is unreachable. Please try again later or ${supportContact}.`;
    }
    if (status >= 500) {
      return `Server error: The roster service is experiencing technical difficulties. Please try again in a few moments or ${supportContact}.`;
    }
    if (status === 404) {
      return `Service not found. Please ${supportContact}.`;
    }
    if (status === 503) {
      return `Service unavailable: The roster service is temporarily down for maintenance. Please try again later or ${supportContact}.`;
    }
  }
  
  // Generic error fallback
  if (error && error.message) {
    console.debug('[ErrorHandler] Generic error:', error.message);
    const supportContact = typeof ENV !== 'undefined' 
      ? `contact BTTC support at ${ENV.SUPPORT_PHONE} (${ENV.SUPPORT_METHOD})`
      : 'contact BTTC support at 510-926-6913 (TEXT ONLY)';
    return `An error occurred during ${context}: ${error.message}. Please try again or ${supportContact}.`;
  }
  
  console.warn('[ErrorHandler] Unknown error format');
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
    const headers = new Headers(options.headers || {});
    headers.set('X-API-Key', apiKey);
    
    console.debug('[ApiHandler] Adding X-API-Key header to request');
    
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
  console.debug('[ApiHandler] Response status:', response.status, response.statusText);
  
  if (!response.ok) {
    let errorMessage = 'Server error';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
      console.debug('[ApiHandler] Error data:', errorData);
    } catch {
      // If response is not JSON, use status text
      errorMessage = response.statusText || `HTTP ${response.status}`;
      console.debug('[ApiHandler] Non-JSON error response');
    }
    
    const error = new Error(errorMessage);
    error.response = response;
    throw error;
  }
  
  try {
    const data = await response.json();
    console.debug('[ApiHandler] Response parsed successfully');
    return data;
  } catch (jsonError) {
    console.error('[ApiHandler] JSON parse error:', jsonError);
    throw new Error('Invalid response from server. Please try again.');
  }
};

// ========================================
// MAIN ROSTER APP COMPONENT
// ========================================
const RosterApp = {
  setup() {
    // Load constants from ENV first
    const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
    const supportPhone = typeof ENV !== 'undefined' ? ENV.SUPPORT_PHONE : '510-926-6913';
    const supportMethod = typeof ENV !== 'undefined' ? ENV.SUPPORT_METHOD : 'TEXT ONLY';
    
    // API endpoint
    const API_URL = `${apiUrl}/rr/roster`;
    
    // Reactive state
    const players = ref([]);
    const loading = ref(true);
    const error = ref('');
    const currentSort = reactive({
      key: null,
      direction: 'asc'
    });

    /**
     * Fetches roster data from the API
     */
    const fetchRoster = async () => {
      console.debug('[RosterApp] Fetching roster data from:', API_URL);
      loading.value = true;
      error.value = '';
      
      try {
        const response = await fetch(API_URL, getFetchOptions());
        const data = await handleApiResponse(response);
        
        console.debug('[RosterApp] Roster data received:', data);
        
        if (!Array.isArray(data)) {
          throw new Error('Invalid roster data format received from server.');
        }
        
        players.value = data;
        console.debug('[RosterApp] Roster loaded successfully, players count:', players.value.length);
      } catch (err) {
        console.error('[RosterApp] Error fetching roster:', err);
        error.value = getErrorMessage(err, 'loading roster');
        players.value = [];
      } finally {
        loading.value = false;
      }
    };

    /**
     * Sorts the roster by the specified column
     * @param {string} key - The column key to sort by
     */
    const sortBy = (key) => {
      console.debug('[RosterApp] Sorting by:', key);
      
      // Determine sort direction
      if (currentSort.key === key && currentSort.direction === 'asc') {
        currentSort.direction = 'desc';
      } else {
        currentSort.direction = 'asc';
      }
      
      currentSort.key = key;
      
      // Sort the players array
      const sorted = [...players.value].sort((a, b) => {
        let valA = a[key] || '';
        let valB = b[key] || '';
        
        // Handle date sorting for registered_at
        if (key === 'registered_at') {
          valA = new Date(valA);
          valB = new Date(valB);
        } else {
          // String comparison for other fields
          valA = valA.toString().toLowerCase();
          valB = valB.toString().toLowerCase();
        }
        
        if (valA < valB) {
          return currentSort.direction === 'asc' ? -1 : 1;
        }
        if (valA > valB) {
          return currentSort.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
      
      players.value = sorted;
      console.debug('[RosterApp] Roster sorted:', { key, direction: currentSort.direction });
    };

    /**
     * Gets the sort class for a column header
     * @param {string} key - The column key
     * @returns {string} - CSS class name
     */
    const getSortClass = (key) => {
      if (currentSort.key !== key) {
        return 'sortable';
      }
      return currentSort.direction === 'asc' ? 'sortable sorted-asc' : 'sortable sorted-desc';
    };

    // Fetch roster on mount
    onMounted(() => {
      console.debug('[RosterApp] Component mounted, fetching roster...');
      fetchRoster();
    });

    // Computed properties
    const hasPlayers = computed(() => players.value.length > 0);
    const playerCount = computed(() => players.value.length);

    return {
      players,
      loading,
      error,
      currentSort,
      hasPlayers,
      playerCount,
      sortBy,
      getSortClass,
      fetchRoster,
      supportPhone,
      supportMethod
    };
  },
  template: `
    <div class="roster-container">
      <a href="bttc_rr_registration_vue.html" class="back-link">← Back to Round Robin Registration</a>
      <h3>Round Robin Player Roster</h3>
      
      <div v-if="loading" class="loading-message">
        Loading roster...
      </div>
      
      <div v-else-if="error" class="error-message">
        <p>{{ error }}</p>
        <p>If the problem persists, please contact BTTC support at {{ supportPhone }} ({{ supportMethod }})</p>
      </div>
      
      <div v-else-if="!hasPlayers" class="empty-message">
        <p>No players registered yet.</p>
      </div>
      
      <div v-else class="roster-table-container">
        <p class="player-count">{{ playerCount }} player{{ playerCount !== 1 ? 's' : '' }} registered</p>
        <table class="roster-table">
          <thead>
            <tr>
              <th 
                :class="getSortClass('registered_at')" 
                @click="sortBy('registered_at')"
              >
                Registered At
              </th>
              <th 
                :class="getSortClass('full_name')" 
                @click="sortBy('full_name')"
              >
                Full Name
              </th>
              <th 
                :class="getSortClass('rating')" 
                @click="sortBy('rating')"
              >
                BTTC Rating
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(player, index) in players" :key="index">
              <td>{{ player.registered_at }}</td>
              <td>{{ player.full_name }}</td>
              <td>{{ player.rating }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `
};

// ========================================
// CREATE VUE APP
// ========================================
const app = createApp({
  components: {
    RosterApp
  },
  errorHandler: (err, instance, info) => {
    // Handle Vue component errors gracefully
    console.error('Vue error:', err, info);
    // Don't show Vue internal errors to users - they're already handled in components
  }
});

// Mount the app
app.mount('#vue-roster-app');

// Handle unhandled promise rejections (network errors, etc.)
window.addEventListener('unhandledrejection', (event) => {
  // If it's a network error, we've already handled it in our try-catch blocks
  // But this catches any edge cases
  const error = event.reason;
  if (error && (error instanceof TypeError || error?.message?.includes('fetch'))) {
    // This is likely already handled by our error handlers, so we can prevent default
    event.preventDefault();
    console.error('Unhandled network error (likely already handled):', error);
  }
});

