// BTTC Round Robin Roster
// Utilities loaded from bttc-utils.js: getErrorMessage, getFetchOptions, handleApiResponse

const { createApp, ref, reactive, computed, onMounted, onUnmounted } = Vue;

const CACHE_KEYS = {
  ROSTER: 'bttc_roster_cache',
  EVENT_METADATA: 'bttc_event_metadata'
};

// Cache TTL configuration (in milliseconds)
// Defaults from ENV or fallback to reasonable defaults
const CACHE_TTL = {
  ROSTER: (typeof ENV !== 'undefined' && ENV.CACHE_TTL_ROSTER ? ENV.CACHE_TTL_ROSTER : 45) * 1000,    // Default: 45 seconds
  EVENT_METADATA: 24 * 60 * 60 * 1000  // 24 hours (event date never changes once set)
};

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

const clearCache = (cacheKey) => {
  try {
    sessionStorage.removeItem(cacheKey);
  } catch {
    // Ignore errors
  }
};

// Helper functions for event metadata cache (shared with registration page)
const getEventMetadataCache = () => {
  try {
    const cached = sessionStorage.getItem(CACHE_KEYS.EVENT_METADATA);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    const now = Date.now();
    const age = now - timestamp;
    
    // Check if cache is still valid (24 hours TTL)
    if (age < CACHE_TTL.EVENT_METADATA) {
      return data;
    }
    
    // Cache expired, remove it
    sessionStorage.removeItem(CACHE_KEYS.EVENT_METADATA);
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
    sessionStorage.setItem(CACHE_KEYS.EVENT_METADATA, JSON.stringify(cacheEntry));
  } catch (err) {
    // sessionStorage unavailable, silently fail
  }
};

const RosterApp = {
  setup() {
    // Load configuration constants from ENV (or use defaults)
    const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : 'http://0.0.0.0:8080';
    const supportPhone = typeof ENV !== 'undefined' ? ENV.SUPPORT_PHONE : '510-926-6913';
    const supportMethod = typeof ENV !== 'undefined' ? ENV.SUPPORT_METHOD : 'TEXT ONLY';
    const defaultPlayerCap = typeof ENV !== 'undefined' ? ENV.DEFAULT_PLAYER_CAP : 64;
    const fallbackPlayerCap = typeof ENV !== 'undefined' ? ENV.FALLBACK_PLAYER_CAP : 65;
    const devOverride = typeof ENV !== 'undefined' ? (ENV.DEV_OVERRIDE ?? false) : false;
    const registrationClosed = typeof ENV !== 'undefined' ? (ENV.REGISTRATION_CLOSED ?? false) : false;
    const timezone = typeof ENV !== 'undefined' ? ENV.TIMEZONE : 'America/Los_Angeles';
    
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
      spotsAvailable: 0,              // Available spots remaining
      eventOpen: true,                // Whether event is accepting registrations
      eventDate: null,                // Event date (ISO format YYYY-MM-DD)
      eventType: null                 // Event type (e.g., "rr", "tournament", "group_training")
    });
    const lastUpdated = ref({
      roster: null,                    // Timestamp when roster was last fetched
      capacity: null                   // Timestamp when capacity was last fetched
    });
    const currentSort = reactive({
      key: 'rating',                   // Column key being sorted (default: 'rating' for high to low)
      direction: 'desc'                // Sort direction: 'asc' or 'desc' (default: 'desc' for high to low)
    });
    const currentTime = ref(Date.now()); // Current time for countdown updates
    let timeIntervalId = null; // Interval ID for cleanup

    // NOTE: Capacity is now included in /rr/roster response
    // No need for separate /rr/capacity calls anymore

    /**
     * Fetches roster data from the API with caching
     * 
     * FLOW:
     * 1. Check cache first - if valid (< 45 seconds), use cached data immediately
     * 2. Set loading state (shows loading indicator)
     * 3. If cache expired/missing, fetch from API
     * 4. Validate response format (new API: { roster: [], capacity: {} }, legacy: array)
     * 5. Extract roster array from response
     * 6. Extract capacity from response (new API includes capacity, no separate call needed)
     * 7. Update cache with fresh roster data
     * 8. Set players state and capacity state
     * 9. On error: Try cached data, then show user-friendly error message
     * 10. Always: Reset loading state
     * 
     * CACHING: Roster data cached for 45 seconds to reduce API calls on page refresh
     * API: New API returns { roster: [], capacity: {} } - capacity included, no separate /capacity call needed
     */
    const fetchRoster = async () => {
      // Check cache first
      const cachedResult = getCachedData(CACHE_KEYS.ROSTER, CACHE_TTL.ROSTER);
      if (cachedResult && cachedResult.data) {
        // Use cached data immediately (no loading state for instant display)
        
        // Restore roster data
        if (Array.isArray(cachedResult.data.roster)) {
          players.value = cachedResult.data.roster;
        } else if (Array.isArray(cachedResult.data)) {
          // Backward compatibility: handle old cache format (just array)
          players.value = cachedResult.data;
        }
        
        // Apply default sort (rating high to low)
        applySort();
        
        // Restore capacity data if available
        if (cachedResult.data.capacity) {
          capacity.value = cachedResult.data.capacity;
          lastUpdated.value.capacity = cachedResult.timestamp;
        }
        
        lastUpdated.value.roster = cachedResult.timestamp;
        loading.value = false;  // Reset loading state when using cache
        
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
        
        // New API response structure: { roster: [], capacity: {} }
        // Handle both new format (object with roster key) and legacy format (direct array) for backward compatibility
        const rosterData = Array.isArray(data) ? data : (data.roster || []);
        
        // Validate response format (should be array of players)
        if (!Array.isArray(rosterData)) {
          throw new Error('Invalid roster data format received from server.');
        }
        
        const now = Date.now();
        
        // Extract capacity from roster response (new API always includes capacity)
        let capacityData = null;
        if (data.capacity) {
          capacityData = {
            isAtCapacity: !!data.capacity.roster_full,
            confirmedCount: Number(data.capacity.confirmed_count || 0),
            playerCap: Number(data.capacity.player_cap || defaultPlayerCap),
            spotsAvailable: Number(data.capacity.spots_available || 0),
            eventOpen: !!data.capacity.event_open,
            eventDate: data.capacity.event_date || null,
            eventType: data.capacity.event_type || null
          };
          
          capacity.value = capacityData;
          lastUpdated.value.capacity = now;
          
          // Cache event metadata separately (long TTL since event date never changes)
          // This cache is shared with the registration page to avoid unnecessary API calls
          if (data.capacity.event_date || data.capacity.event_type) {
            setEventMetadataCache(data.capacity.event_date, data.capacity.event_type);
          }
        } else {
          // If capacity not included (should not happen with new API), continue without capacity
        }
        
        // Update cache with fresh data (store both roster and capacity)
        const cacheData = {
          roster: rosterData,
          capacity: capacityData
        };
        setCachedData(CACHE_KEYS.ROSTER, cacheData);
        
        // Set players state with fresh data and timestamp
        players.value = rosterData;
        
        // Apply default sort (rating high to low)
        applySort();
        
        lastUpdated.value.roster = now;
      } catch (err) {
        // On error, try to use cached data as fallback (even if expired)
        const cachedResult = getCachedData(CACHE_KEYS.ROSTER, CACHE_TTL.ROSTER * 2); // Allow stale cache on error
        if (cachedResult && cachedResult.data) {
          // Restore roster data from stale cache
          if (Array.isArray(cachedResult.data.roster)) {
            players.value = cachedResult.data.roster;
            lastUpdated.value.roster = cachedResult.timestamp;
          } else if (Array.isArray(cachedResult.data)) {
            // Backward compatibility: handle old cache format (just array)
            players.value = cachedResult.data;
            lastUpdated.value.roster = cachedResult.timestamp;
          }
          
          // Apply default sort (rating high to low)
          applySort();
          
          // Restore capacity data if available
          if (cachedResult.data.capacity) {
            capacity.value = cachedResult.data.capacity;
            lastUpdated.value.capacity = cachedResult.timestamp;
          }
          
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
     * Applies the current sort state to the players array
     * Helper function to sort players based on currentSort state
     */
    const applySort = () => {
      if (!currentSort.key || players.value.length === 0) {
        return;
      }
      
      const key = currentSort.key;
      const sorted = [...players.value].sort((a, b) => {
        let valA = a[key] || '';
        let valB = b[key] || '';
        
        // Handle date sorting for 'registered_at' column
        // Convert to Date objects for proper date comparison
        if (key === 'registered_at') {
          valA = new Date(valA);
          valB = new Date(valB);
        } else if (key === 'rating') {
          // Numeric comparison for rating column
          valA = Number(valA) || 0;
          valB = Number(valB) || 0;
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
      
      // Apply the sort
      applySort();
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
     * 3. Format with user-friendly format: Nov 1, 2025, HH:MM:SS AM/PM PST/PDT
     * 4. Handle invalid dates gracefully (return original string)
     * 
     * WHY: API returns dates in UTC/ISO format, but users expect PST/PDT times
     * 
     * @param {string} dateString - Date string from API (ISO format)
     * @returns {string} - Formatted date string in PST/PDT (e.g., "Nov 1, 2025, 2:30:45 PM PST")
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
          month: 'short',
          day: 'numeric',
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
    onMounted(async () => {
      await fetchRoster();
      
      // Update current time every second for countdown display
      timeIntervalId = setInterval(() => {
        currentTime.value = Date.now();
      }, 1000);
    });
    
    // Clean up interval when component unmounts
    onUnmounted(() => {
      if (timeIntervalId) {
        clearInterval(timeIntervalId);
        timeIntervalId = null;
      }
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
    
    /**
     * Computed property to get the day of the week from the event date
     * Returns abbreviated day name (e.g., "Fri", "Mon", "Sun")
     */
    const eventDayOfWeek = computed(() => {
      if (!capacity.value.eventDate) return '';
      
      try {
        const date = new Date(capacity.value.eventDate + 'T00:00:00'); // Add time to avoid timezone issues
        
        // Check if date is valid
        if (isNaN(date.getTime())) {
          return '';
        }
        
        // Format day as abbreviated day name (e.g., "Fri", "Mon", "Sun")
        const dayOfWeek = date.toLocaleDateString("en-US", {
          weekday: 'short'
        });
        
        return dayOfWeek;
      } catch (err) {
        return '';
      }
    });
    
    /**
     * Computed: Time until next roster update (in seconds)
     * Calculates remaining time until cache expires and fresh data will be fetched
     * Returns null if no roster data has been loaded yet
     */
    const nextUpdateIn = computed(() => {
      if (!lastUpdated.value.roster) return null;
      
      const now = currentTime.value;
      const lastUpdateTime = lastUpdated.value.roster;
      const age = now - lastUpdateTime;
      const remaining = CACHE_TTL.ROSTER - age;
      
      // If cache has expired, return 0 (update should happen soon)
      if (remaining <= 0) return 0;
      
      return Math.ceil(remaining / 1000); // Return seconds
    });
    
    /**
     * Computed: Formatted "next update" string
     * Shows countdown until next update (e.g., "Next update in 30 seconds")
     * Returns empty string if no data available
     */
    const nextUpdateText = computed(() => {
      const seconds = nextUpdateIn.value;
      if (seconds === null) return '';
      
      if (seconds <= 0) {
        return 'Refresh page to get latest data';
      } else if (seconds < 60) {
        return `Next update in ${seconds} second${seconds !== 1 ? 's' : ''}`;
      } else {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (remainingSeconds === 0) {
          return `Next update in ${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else {
          return `Next update in ${minutes}m ${remainingSeconds}s`;
        }
      }
    });
    
    /**
     * Computed: Check if today's date is after the event date
     * Returns true if event date exists and today is after it
     */
    const isAfterEventDate = computed(() => {
      if (!capacity.value.eventDate) return false;
      
      try {
        const now = new Date();
        const pstNow = new Date(now.toLocaleString("en-US", {timeZone: timezone}));
        const eventDate = new Date(capacity.value.eventDate + 'T00:00:00');
        
        // Compare dates (ignore time, just compare dates)
        const today = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate());
        const event = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
        
        return today > event;
      } catch (err) {
        return false;
      }
    });
    
    /**
     * Computed: Determine if we should show the closed message instead of roster
     * Roster is ONLY open from Wednesday 00:00 to Saturday 00:00
     * AND if REGISTRATION_CLOSED = false
     * DEV_OVERRIDE = true unlocks the roster (bypasses all constraints)
     * Priority order: DEV_OVERRIDE > REGISTRATION_CLOSED > normal schedule
     */
    const shouldShowClosedMessage = computed(() => {
      // Priority order: DEV_OVERRIDE > REGISTRATION_CLOSED > normal schedule
      // If DEV_OVERRIDE is true, always show roster (don't show closed message)
      if (devOverride) return false;
      
      // If REGISTRATION_CLOSED is true, show closed message
      if (registrationClosed) return true;

      // Normal schedule check: Wednesday 00:00 to Saturday 00:00
      const now = new Date();
      const pstNow = new Date(now.toLocaleString("en-US", {timeZone: timezone}));
      const dayOfWeek = pstNow.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
      const hours = pstNow.getHours();
      const minutes = pstNow.getMinutes();
      
      // Wednesday (day 3): show roster if at or after midnight (00:00)
      if (dayOfWeek === 3) {
        return !(hours >= 0 && minutes >= 0); // Show closed message if before 00:00
      }
      
      // Thursday (day 4): always show roster
      if (dayOfWeek === 4) {
        return false; // Don't show closed message
      }
      
      // Friday (day 5): always show roster
      if (dayOfWeek === 5) {
        return false; // Don't show closed message
      }
      
      // Saturday (day 6): hide roster at midnight (00:00) or later
      if (dayOfWeek === 6) {
        return true; // Show closed message starting at Saturday 00:00
      }
      
      // All other days (Sunday, Monday, Tuesday): hide roster
      return true; // Show closed message
    });
    
    /**
     * Computed: Closed message text (same as registration page)
     */
    const closedMessage = computed(() => {
      if (registrationClosed) {
        return 'Registration is currently closed. Please review this month\'s schedule on our homepage.';
      }
      return 'Registration is currently closed.';
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
      formattedEventDate,
      eventDayOfWeek,
      nextUpdateText,
      shouldShowClosedMessage,
      closedMessage,
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
      <a href="../registration/" class="back-link">← Back to Round Robin Registration</a>
      <h3>Round Robin Registered Players</h3>
      <p v-if="formattedEventDate && capacity.eventOpen" class="event-date">For {{ eventDayOfWeek }}, {{ formattedEventDate }}</p>
      
      <!-- Show closed message if event is closed and today is after event date -->
      <div v-if="shouldShowClosedMessage" class="status-banner status-closed">
        <div>🔴 Registration is CLOSED</div>
        <div class="status-details">
          {{ closedMessage }}
        </div>
      </div>
      
      <!-- Show roster content if not showing closed message -->
      <template v-else>
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
          <span class="player-count-left">
            <span v-if="!capacity.eventOpen && capacity.playerCap > 0" class="event-closed-text">{{ capacity.confirmedCount }}/{{ capacity.playerCap }} • Registration closed</span>
            <span v-else-if="!capacity.eventOpen">{{ playerCount }} player{{ playerCount !== 1 ? 's' : '' }} registered • Registration closed</span>
            <span v-else-if="capacity.isAtCapacity" class="capacity-full-text">{{ capacity.confirmedCount }}/{{ capacity.playerCap }} • Full</span>
            <span v-else-if="capacity.playerCap > 0">{{ capacity.confirmedCount }}/{{ capacity.playerCap }} • {{ spotsRemaining }} spot{{ spotsRemaining !== 1 ? 's' : '' }} remaining</span>
            <span v-else>{{ playerCount }} player{{ playerCount !== 1 ? 's' : '' }} registered</span>
          </span>
          <span v-if="nextUpdateText" class="next-update">
            • {{ nextUpdateText }}
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
      </template>
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

