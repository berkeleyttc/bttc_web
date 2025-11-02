/**
 * BTTC Round Robin Roster - Vue.js
 * 
 * Simple and elegant roster display for Round Robin tournament players.
 * 
 * APPLICATION OVERVIEW:
 * This Vue.js application displays the current roster of players registered
 * for the Round Robin tournament, with capacity information and sorting capabilities.
 * 
 * COMPONENT STRUCTURE:
 * - RosterApp: Main app component that fetches and displays roster
 *   ├── CapacityBanner: Shows capacity information (spots remaining, full status)
 *   └── RosterTable: Displays player roster with sorting
 * 
 * APPLICATION FLOW:
 * 1. App loads → Fetches roster from /rr/roster API endpoint
 * 2. After roster loaded → Fetches capacity from /rr/capacity endpoint
 * 3. Displays roster → Table with player names, BTTC IDs, registration times
 * 4. User clicks column header → Sorts table by that column
 * 5. Displays capacity → Shows spots remaining, full status
 * 
 * FEATURES:
 * - Sortable table columns (name, BTTC ID, registered time)
 * - Real-time capacity information
 * - User-friendly date/time formatting (PST/PDT)
 * - Error handling with user-friendly messages
 * 
 * @file js/roster-vue.js
 */

const { createApp, ref, reactive, computed, onMounted } = Vue;

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
 * @param {string} context - Context of the operation (e.g., 'loading roster', 'capacity check')
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
    return `Unable to connect to the server. The roster service may be temporarily unavailable. Please try again in a few moments or ${supportContact}.`;
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
// CACHE UTILITIES
// ========================================

/**
 * Cache Utilities
 * 
 * PURPOSE: Implements client-side caching for API responses to reduce API calls
 * 
 * CACHE STRATEGY:
 * - Uses sessionStorage for cache persistence (cleared on tab close)
 * - Stores data with timestamp to implement TTL (Time To Live)
 * - Returns cached data if still valid, otherwise fetches fresh data
 */

const CACHE_KEYS = {
  ROSTER: 'bttc_roster_cache'
};

// Cache TTL configuration (in milliseconds)
// Defaults from ENV or fallback to reasonable defaults
const CACHE_TTL = {
  ROSTER: (typeof ENV !== 'undefined' && ENV.CACHE_TTL_ROSTER ? ENV.CACHE_TTL_ROSTER : 45) * 1000    // Default: 45 seconds
};

/**
 * Gets cached data if still valid (within TTL)
 * 
 * @param {string} cacheKey - Cache key to retrieve
 * @param {number} ttl - Time to live in milliseconds
 * @returns {object|null} - Cached data with { data, timestamp } or null if expired/missing
 */
const getCachedData = (cacheKey, ttl) => {
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    const now = Date.now();
    const age = now - timestamp;
    
    // Check if cache is still valid (within TTL)
    if (age < ttl) {
      return { data, timestamp };
    }
    
    // Cache expired, remove it
    sessionStorage.removeItem(cacheKey);
    return null;
  } catch (err) {
    // Cache corrupted or unavailable, remove it
    try {
      sessionStorage.removeItem(cacheKey);
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }
};

/**
 * Stores data in cache with current timestamp
 * 
 * @param {string} cacheKey - Cache key to store
 * @param {*} data - Data to cache
 */
const setCachedData = (cacheKey, data) => {
  try {
    const cacheEntry = {
      data: data,
      timestamp: Date.now()
    };
    sessionStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
  } catch (err) {
    // sessionStorage unavailable or quota exceeded, silently fail
    // Cache is a performance optimization, not critical functionality
  }
};

/**
 * Clears cached data for a specific key
 * 
 * @param {string} cacheKey - Cache key to clear
 */
const clearCache = (cacheKey) => {
  try {
    sessionStorage.removeItem(cacheKey);
  } catch {
    // Ignore errors
  }
};

// ========================================
// MAIN ROSTER APP COMPONENT
// ========================================

/**
 * RosterApp Component
 * 
 * PURPOSE: Displays the current Round Robin tournament roster with capacity information
 * 
 * COMPONENT HIERARCHY:
 * RosterApp (this component)
 *   ├── CapacityBanner: Shows capacity info (spots remaining, full status)
 *   └── RosterTable: Displays player list with sorting
 * 
 * APPLICATION FLOW:
 * 1. Component mounts → fetchRoster() is called
 * 2. Fetch roster → GET /rr/roster endpoint
 * 3. After roster loaded → fetchCapacity() is called
 * 4. Fetch capacity → POST /rr/capacity endpoint
 * 5. Display data → Shows roster table with capacity banner
 * 6. User clicks column → sortBy() sorts the table
 * 
 * FEATURES:
 * - Sortable columns (name, BTTC ID, registered_at)
 * - Real-time capacity display
 * - User-friendly date/time formatting (PST/PDT)
 * - Error handling with user-friendly messages
 */
const RosterApp = {
  setup() {
    // Load configuration constants from ENV (or use defaults)
    const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
    const supportPhone = typeof ENV !== 'undefined' ? ENV.SUPPORT_PHONE : '510-926-6913';
    const supportMethod = typeof ENV !== 'undefined' ? ENV.SUPPORT_METHOD : 'TEXT ONLY';
    const defaultPlayerCap = typeof ENV !== 'undefined' ? ENV.DEFAULT_PLAYER_CAP : 64;
    const fallbackPlayerCap = typeof ENV !== 'undefined' ? ENV.FALLBACK_PLAYER_CAP : 65;
    
    // API endpoint for fetching roster
    const API_URL = `${apiUrl}/rr/roster`;
    
    // Application state
    const players = ref([]);          // Array of player objects from API
    const loading = ref(true);        // Loading state during API calls
    const error = ref('');            // Error message to display
    const capacity = ref({
      isAtCapacity: false,             // Whether event is at capacity
      confirmedCount: 0,              // Number of confirmed registrations
      playerCap: fallbackPlayerCap,   // Maximum capacity
      spotsAvailable: 0               // Available spots remaining
    });
    const lastUpdated = ref({
      roster: null,                    // Timestamp when roster was last fetched
      capacity: null                   // Timestamp when capacity was last fetched
    });
    const currentSort = reactive({
      key: null,                       // Column key being sorted (e.g., 'first_name', 'registered_at')
      direction: 'asc'                 // Sort direction: 'asc' or 'desc'
    });

    /**
     * Fetches capacity data from the API (no caching)
     * 
     * FLOW:
     * 1. Fetch from API (no caching)
     * 2. Parse response data (roster_full, confirmed_count, player_cap, spots_available)
     * 3. Update capacity state
     * 4. On error: Set defaults
     * 
     * WHY: Called after fetchRoster() to get real-time capacity information
     * NOTE: Capacity data is always fetched fresh (no caching)
     */
    const fetchCapacity = async () => {
      // Always fetch fresh capacity data (no caching)
      await fetchFreshCapacity();
    };
    
    /**
     * Fetches fresh capacity data from API (no caching)
     */
    const fetchFreshCapacity = async () => {
      try {
        const fetchOptions = getFetchOptions({ method: 'POST' });
        const response = await fetch(`${apiUrl}/rr/capacity`, fetchOptions);
        const data = await handleApiResponse(response);
        
        const capacityData = {
          isAtCapacity: !!data.roster_full,
          confirmedCount: Number(data.confirmed_count || 0),
          playerCap: Number(data.player_cap || defaultPlayerCap),
          spotsAvailable: Number(data.spots_available || 0)
        };
        
        const now = Date.now();
        
        // Update state with fresh data and timestamp
        capacity.value = capacityData;
        lastUpdated.value.capacity = now;
      } catch (err) {
        // On error, set defaults
        capacity.value = { 
          isAtCapacity: false, 
          confirmedCount: 0, 
          playerCap: fallbackPlayerCap, 
          spotsAvailable: 0 
        };
        lastUpdated.value.capacity = null;
      }
    };

    /**
     * Fetches roster data from the API with caching
     * 
     * FLOW:
     * 1. Check cache first - if valid (< 45 seconds), use cached data immediately
     * 2. Set loading state (shows loading indicator)
     * 3. If cache expired/missing, fetch from API
     * 4. Validate response is an array
     * 5. Update cache with fresh data
     * 6. Set players state
     * 7. Fetch capacity information (capacity check depends on roster being loaded)
     * 8. On error: Try cached data, then show user-friendly error message
     * 9. Always: Reset loading state
     * 
     * CACHING: Roster data cached for 45 seconds to reduce API calls on page refresh
     */
    const fetchRoster = async () => {
      // Check cache first
      const cachedResult = getCachedData(CACHE_KEYS.ROSTER, CACHE_TTL.ROSTER);
      if (cachedResult && Array.isArray(cachedResult.data)) {
        // Use cached data immediately (no loading state for instant display)
        players.value = cachedResult.data;
        lastUpdated.value.roster = cachedResult.timestamp;
        loading.value = false;  // Reset loading state when using cache
        
        try {
          // Fetch capacity for cached roster
          await fetchCapacity();
        } catch (err) {
          // If capacity fetch fails, still show roster data
          // Error is handled in fetchCapacity, just continue
        }
        
        // Cache is valid, no API call needed
        return;
      }
      
      // No valid cache, fetch from API with loading state
      await fetchFreshRoster();
    };
    
    /**
     * Fetches fresh roster data from API and updates cache
     */
    const fetchFreshRoster = async () => {
      loading.value = true;  // Show loading indicator
      error.value = '';      // Clear previous errors
      
      try {
        // Fetch roster from API
        const response = await fetch(API_URL, getFetchOptions());
        const data = await handleApiResponse(response);
        
        // Validate response format (should be array of players)
        if (!Array.isArray(data)) {
          throw new Error('Invalid roster data format received from server.');
        }
        
        const now = Date.now();
        
        // Update cache with fresh data
        setCachedData(CACHE_KEYS.ROSTER, data);
        
        // Set players state with fresh data and timestamp
        players.value = data;
        lastUpdated.value.roster = now;
        
        // Fetch capacity information after roster is loaded
        // Capacity endpoint may depend on roster being loaded first
        await fetchCapacity();
      } catch (err) {
        // On error, try to use cached data as fallback (even if expired)
        const cachedResult = getCachedData(CACHE_KEYS.ROSTER, CACHE_TTL.ROSTER * 2); // Allow stale cache on error
        if (cachedResult && Array.isArray(cachedResult.data)) {
          players.value = cachedResult.data;
          lastUpdated.value.roster = cachedResult.timestamp;
          await fetchCapacity();
          return;
        }
        
        // No cache available, show error
        error.value = getErrorMessage(err, 'loading roster');
        players.value = [];
        lastUpdated.value.roster = null;
      } finally {
        // Always reset loading state (even on error)
        loading.value = false;
      }
    };

    /**
     * Sorts the roster by the specified column
     * 
     * BEHAVIOR:
     * - Clicking same column toggles sort direction (asc ↔ desc)
     * - Clicking different column sets it as sort key with asc direction
     * - Handles date sorting for 'registered_at' column
     * - Handles string sorting for other columns (case-insensitive)
     * 
     * SORT LOGIC:
     * - First click: Sort ascending
     * - Second click (same column): Sort descending
     * - Click different column: Sort ascending
     * 
     * @param {string} key - The column key to sort by (e.g., 'first_name', 'bttc_id', 'registered_at')
     */
    const sortBy = (key) => {
      // Toggle sort direction if clicking the same column
      // Otherwise, start with ascending
      if (currentSort.key === key && currentSort.direction === 'asc') {
        currentSort.direction = 'desc';
      } else {
        currentSort.direction = 'asc';
      }
      
      // Set the current sort key
      currentSort.key = key;
      
      // Sort the players array (create copy to avoid mutating original)
      const sorted = [...players.value].sort((a, b) => {
        let valA = a[key] || '';
        let valB = b[key] || '';
        
        // Handle date sorting for 'registered_at' column
        // Convert to Date objects for proper date comparison
        if (key === 'registered_at') {
          valA = new Date(valA);
          valB = new Date(valB);
        } else {
          // String comparison for other fields (case-insensitive)
          valA = valA.toString().toLowerCase();
          valB = valB.toString().toLowerCase();
        }
        
        // Compare values based on sort direction
        if (valA < valB) {
          return currentSort.direction === 'asc' ? -1 : 1;
        }
        if (valA > valB) {
          return currentSort.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
      
      players.value = sorted;
    };

    /**
     * Gets the CSS class for a column header based on current sort state
     * 
     * BEHAVIOR:
     * - If column is not currently sorted: returns 'sortable'
     * - If column is sorted ascending: returns 'sortable sorted-asc'
     * - If column is sorted descending: returns 'sortable sorted-desc'
     * 
     * Used to style column headers with sort indicators (arrows).
     * 
     * @param {string} key - The column key (e.g., 'first_name', 'bttc_id', 'registered_at')
     * @returns {string} - CSS class name(s) for the column header
     */
    const getSortClass = (key) => {
      // If this column is not currently being sorted, just show it's sortable
      if (currentSort.key !== key) {
        return 'sortable';
      }
      // If this column is being sorted, add direction class
      return currentSort.direction === 'asc' ? 'sortable sorted-asc' : 'sortable sorted-desc';
    };

    /**
     * Formats a date string in PST/PDT timezone for user-friendly display
     * 
     * FLOW:
     * 1. Parse date string from API (ISO format)
     * 2. Convert to PST/PDT timezone (America/Los_Angeles)
     * 3. Format with user-friendly format: MM/DD/YYYY, HH:MM:SS AM/PM PST/PDT
     * 4. Handle invalid dates gracefully (return original string)
     * 
     * WHY: API returns dates in UTC/ISO format, but users expect PST/PDT times
     * 
     * @param {string} dateString - Date string from API (ISO format)
     * @returns {string} - Formatted date string in PST/PDT (e.g., "01/15/2024, 2:30:45 PM PST")
     */
    const formatDatePST = (dateString) => {
      if (!dateString) {
        return '';
      }

      try {
        const timezone = typeof ENV !== 'undefined' ? ENV.TIMEZONE : 'America/Los_Angeles';
        const date = new Date(dateString);
        
        // Check if date is valid
        if (isNaN(date.getTime())) {
          return dateString; // Return original if invalid
        }

        // Format date in PST/PDT timezone
        const formatted = date.toLocaleString("en-US", {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });

        // Get timezone abbreviation (PST/PDT)
        const timezoneAbbr = date.toLocaleTimeString("en-US", {
          timeZone: timezone,
          timeZoneName: 'short'
        }).split(' ').pop() || 'PST';

        // Combine formatted date with timezone
        const result = `${formatted} ${timezoneAbbr}`;
        
        return result;
      } catch (err) {
        return dateString; // Return original on error
      }
    };

    // Fetch roster when component mounts (when page loads)
    onMounted(() => {
      fetchRoster();
    });

    // Computed properties (derived state from reactive data)
    
    /**
     * Computed: Whether there are any players in the roster
     * Used to conditionally show/hide roster table
     */
    const hasPlayers = computed(() => players.value.length > 0);
    
    /**
     * Computed: Total number of players registered
     * Used in display: "X players registered"
     */
    const playerCount = computed(() => players.value.length);
    
    /**
     * Computed: Number of spots remaining before event reaches capacity
     * Calculated as: playerCap - confirmedCount
     * Returns 0 if already at/over capacity
     * Used in capacity banner display
     */
    const spotsRemaining = computed(() => {
      return Math.max(0, capacity.value.playerCap - capacity.value.confirmedCount);
    });
    
    /**
     * Formats a timestamp into a user-friendly "last updated" string
     * Shows relative time for recent updates (e.g., "5 seconds ago") or formatted time for older
     * 
     * @param {number|null} timestamp - Timestamp in milliseconds, or null if no data
     * @returns {string} - Formatted "last updated" string
     */
    const formatLastUpdated = (timestamp) => {
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
    };
    
    /**
     * Computed: Formatted "last updated" string for roster data
     */
    const rosterLastUpdated = computed(() => {
      if (!lastUpdated.value.roster) return '';
      return formatLastUpdated(lastUpdated.value.roster);
    });
    
    /**
     * Computed: Formatted "last updated" string for capacity data
     */
    const capacityLastUpdated = computed(() => {
      if (!lastUpdated.value.capacity) return '';
      return formatLastUpdated(lastUpdated.value.capacity);
    });

    return {
      players,
      loading,
      error,
      capacity,
      currentSort,
      hasPlayers,
      playerCount,
      spotsRemaining,
      rosterLastUpdated,
      capacityLastUpdated,
      sortBy,
      getSortClass,
      formatDatePST,
      fetchRoster,
      supportPhone,
      supportMethod
    };
  },
  template: `
    <div class="roster-container">
      <a href="bttc_rr_registration_vue.html" class="back-link">← Back to Round Robin Registration</a>
      <h3>Round Robin Registered Players</h3>
      
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
        <p class="player-count">
          {{ playerCount }} player{{ playerCount !== 1 ? 's' : '' }} registered
          <span v-if="capacity.playerCap > 0">
            • {{ capacity.confirmedCount }}/{{ capacity.playerCap }} capacity
            <span v-if="spotsRemaining > 0">• {{ spotsRemaining }} spot{{ spotsRemaining !== 1 ? 's' : '' }} remaining</span>
            <span v-else class="capacity-full-text">• Full</span>
          </span>
          <span v-if="rosterLastUpdated" class="last-updated">
            • Updated {{ rosterLastUpdated }}
          </span>
        </p>
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
              <td>{{ formatDatePST(player.registered_at) }}</td>
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
  }
});

