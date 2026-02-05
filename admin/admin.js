// BTTC Admin Approval Page
// Utilities loaded from bttc-utils.js: getErrorMessage, getFetchOptions, handleApiResponse


const { createApp, ref, reactive, computed, onMounted } = Vue;

// Session storage keys
const AUTH_KEY = 'bttc_admin_auth';
const AUTH_TOKEN_KEY = 'bttc_admin_token';
const AUTH_EXPIRES_KEY = 'bttc_admin_expires';

const AdminApp = {
  setup() {
    // Authentication state
    const isAuthenticated = ref(false);
    const username = ref('');
    const password = ref('');
    const loginError = ref('');
    const isLoggingIn = ref(false);

    // Data state
    const players = ref([]);
    const loading = ref(false);
    const error = ref(null);
    const eventDate = ref('');
    const eventType = ref('');
    const successMessage = ref('');
    const processingPlayers = ref(new Set());
    const currentSort = reactive({
      key: 'registered_at',    // Default sort by registration date
      direction: 'desc'         // Newest first
    });
    const isLocalDevMode = ref(false);

    // Computed properties
    const pendingPlayers = computed(() => {
      const filtered = players.value.filter(p => {
        if (!p.status || p.status === null || p.status === undefined) {
          return true; // null/undefined status = pending
        }
        
        // Handle both uppercase and lowercase status values
        const status = p.status.toString().toLowerCase();
        return status === 'pending' || status === 'pending_payment';
      });
      
      // Apply sorting
      return sortPlayers(filtered);
    });

    const playerCount = computed(() => pendingPlayers.value.length);

    // Check if already authenticated on mount
    onMounted(() => {
      // Detect dev mode immediately
      const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';
      isLocalDevMode.value = apiUrl.includes('localhost') || apiUrl.includes('0.0.0.0') || apiUrl.includes('127.0.0.1');
      
      console.log('[AdminApp] Mode detected:', isLocalDevMode.value ? 'Local Development' : 'Production');
      
      checkAuth();
    });

    // Authentication methods
    const checkAuth = () => {
      try {
        const isAuth = sessionStorage.getItem(AUTH_KEY);
        const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
        const expires = sessionStorage.getItem(AUTH_EXPIRES_KEY);
        
        // Check if authenticated and token hasn't expired
        if (isAuth === 'true' && token && expires) {
          const expiresAt = parseInt(expires, 10);
          if (Date.now() < expiresAt) {
            isAuthenticated.value = true;
            fetchPlayers();
            return;
          }
        }
        
        // Clear expired session
        clearAuth();
      } catch (err) {
        console.error('[AdminApp] Failed to check auth:', err);
        clearAuth();
      }
    };

    const clearAuth = () => {
      try {
        sessionStorage.removeItem(AUTH_KEY);
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        sessionStorage.removeItem(AUTH_EXPIRES_KEY);
      } catch (err) {
        console.error('[AdminApp] Failed to clear auth:', err);
      }
    };

    const login = async () => {
      loginError.value = '';
      isLoggingIn.value = true;
      
      // Validate inputs
      if (!username.value.trim()) {
        loginError.value = 'Please enter a username.';
        isLoggingIn.value = false;
        return;
      }
      
      if (!password.value) {
        loginError.value = 'Please enter a password.';
        isLoggingIn.value = false;
        return;
      }

      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';
        
        // Detect if we're in local development mode
        const isLocalDev = apiUrl.includes('localhost') || apiUrl.includes('0.0.0.0') || apiUrl.includes('127.0.0.1');
        isLocalDevMode.value = isLocalDev;
        
        if (isLocalDev) {
          // Local development: Use credentials from ENV
          console.log('[AdminApp] Local development mode - using ENV credentials');
          
          const localUsername = typeof ENV !== 'undefined' ? ENV.ADMIN_USERNAME : 'admin';
          const localPassword = typeof ENV !== 'undefined' ? ENV.ADMIN_PASSWORD : 'bttc2024';
          
          if (username.value.trim() === localUsername && password.value === localPassword) {
            console.log('[AdminApp] Local login successful');
            
            // Generate a mock token for local dev
            const mockToken = 'local-dev-token-' + Date.now();
            const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
            
            // Store authentication state
            sessionStorage.setItem(AUTH_KEY, 'true');
            sessionStorage.setItem(AUTH_TOKEN_KEY, mockToken);
            sessionStorage.setItem(AUTH_EXPIRES_KEY, expiresAt.toString());
            
            isAuthenticated.value = true;
            password.value = '';
            
            await fetchPlayers();
          } else {
            console.log('[AdminApp] Local login failed');
            loginError.value = 'Invalid username or password.';
          }
        } else {
          // Production: Use Netlify Function
          console.log('[AdminApp] Production mode - calling authentication function');
          
          const baseUrl = apiUrl.replace('/rr', '').replace('/api', '');
          
          const response = await fetch(`${baseUrl}/admin-login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              username: username.value.trim(),
              password: password.value
            })
          });

          const data = await response.json();
          
          if (response.ok && data.success) {
            console.log('[AdminApp] Login successful');
            
            // Store authentication state
            sessionStorage.setItem(AUTH_KEY, 'true');
            sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
            sessionStorage.setItem(AUTH_EXPIRES_KEY, data.expiresAt.toString());
            
            isAuthenticated.value = true;
            password.value = '';
            
            await fetchPlayers();
          } else {
            console.log('[AdminApp] Login failed:', data.message);
            loginError.value = data.message || 'Invalid username or password.';
          }
        }
      } catch (err) {
        console.error('[AdminApp] Login error:', err);
        loginError.value = 'Unable to connect to authentication server. Please try again.';
      } finally {
        isLoggingIn.value = false;
      }
    };

    const logout = () => {
      try {
        clearAuth();
        isAuthenticated.value = false;
        username.value = '';
        password.value = '';
        players.value = [];
        error.value = null;
        loginError.value = '';
        console.log('[AdminApp] Logged out successfully');
      } catch (err) {
        console.error('[AdminApp] Failed to logout:', err);
      }
    };

    const handleLoginKeypress = (event) => {
      if (event.key === 'Enter') {
        login();
      }
    };

    // Data fetching methods
    const fetchPlayers = async () => {
      loading.value = true;
      error.value = null;

      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';
        
        console.log('[AdminApp] Fetching roster with include_id=true...');
        
        const response = await fetch(
          `${apiUrl}/rr/roster?include_id=true`,
          getFetchOptions()
        );
        
        const data = await handleApiResponse(response);
        
        console.log('[AdminApp] Roster fetched:', data);

        // Update state
        players.value = data.roster || [];
        eventDate.value = data.event_date || '';
        eventType.value = data.event_type || '';

        console.log(`[AdminApp] Found ${pendingPlayers.value.length} pending players`);
      } catch (err) {
        console.error('[AdminApp] Failed to fetch players:', err);
        error.value = getErrorMessage(err, 'fetching pending registrations');
      } finally {
        loading.value = false;
      }
    };

    // Confirm registration
    const confirmPlayer = async (player) => {
      if (!player.internal_user_id) {
        console.error('[AdminApp] Missing internal_user_id for player:', player);
        showError('Cannot confirm player: Missing user ID');
        return;
      }

      // Add player to processing set
      processingPlayers.value.add(player.internal_user_id);

      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';
        
        console.log('[AdminApp] Confirming player:', player.internal_user_id);

        const response = await fetch(
          `${apiUrl}/rr/registration/confirm`,
          getFetchOptions({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              internal_user_id: player.internal_user_id
            })
          })
        );

        const data = await handleApiResponse(response);

        console.log('[AdminApp] Player confirmed:', data);

        // Show success message
        const playerName = player.full_name || `${player.first_name} ${player.last_name}`;
        showSuccess(`Successfully confirmed ${playerName}`);

        // Refresh the list
        await fetchPlayers();
      } catch (err) {
        console.error('[AdminApp] Failed to confirm player:', err);
        const playerName = player.full_name || `${player.first_name} ${player.last_name}`;
        showError(`Failed to confirm ${playerName}: ${err.message}`);
      } finally {
        // Remove player from processing set
        processingPlayers.value.delete(player.internal_user_id);
      }
    };

    // Helper methods
    const sortPlayers = (playerList) => {
      if (!currentSort.key || playerList.length === 0) {
        return playerList;
      }
      
      const key = currentSort.key;
      const sorted = [...playerList].sort((a, b) => {
        let valA = a[key] || '';
        let valB = b[key] || '';
        
        // Handle date sorting for 'registered_at' column
        if (key === 'registered_at') {
          valA = new Date(valA);
          valB = new Date(valB);
        } else if (key === 'status') {
          // Normalize null/undefined to 'pending' for sorting
          valA = (a.status ?? 'pending').toString().toLowerCase();
          valB = (b.status ?? 'pending').toString().toLowerCase();
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
      
      return sorted;
    };

    const sortBy = (key) => {
      // Toggle sort direction if clicking the same column
      if (currentSort.key === key) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        // New column, start with ascending (except for registered_at which defaults to desc)
        currentSort.key = key;
        currentSort.direction = key === 'registered_at' ? 'desc' : 'asc';
      }
    };

    const getSortClass = (key) => {
      if (currentSort.key !== key) return 'sortable';
      return currentSort.direction === 'asc' ? 'sortable sorted-asc' : 'sortable sorted-desc';
    };

    const showSuccess = (message) => {
      successMessage.value = message;
      setTimeout(() => {
        successMessage.value = '';
      }, 3000);
    };

    const showError = (message) => {
      error.value = message;
    };

    const isProcessing = (player) => {
      return processingPlayers.value.has(player.internal_user_id);
    };

    const formatStatus = (status) => {
      if (!status || status === null || status === undefined) {
        return 'Pending';
      }
      if (status === 'PENDING_PAYMENT') {
        return 'Pending Payment';
      }
      return status.charAt(0) + status.slice(1).toLowerCase();
    };

    const formatEventDate = (dateStr) => {
      if (!dateStr) return 'Not set';
      
      try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC'
        });
      } catch (err) {
        console.error('[AdminApp] Failed to format date:', err);
        return dateStr;
      }
    };

    const formatRegisteredAt = (dateStr) => {
      if (!dateStr) return 'N/A';
      
      try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Los_Angeles'
        });
      } catch (err) {
        console.error('[AdminApp] Failed to format registered_at:', err);
        return dateStr;
      }
    };

    return {
      // Auth state
      isAuthenticated,
      username,
      password,
      loginError,
      isLoggingIn,
      
      // Data state
      players,
      loading,
      error,
      eventDate,
      eventType,
      successMessage,
      currentSort,
      isLocalDevMode,
      
      // Computed
      pendingPlayers,
      playerCount,
      
      // Methods
      login,
      logout,
      handleLoginKeypress,
      fetchPlayers,
      confirmPlayer,
      isProcessing,
      formatStatus,
      formatEventDate,
      formatRegisteredAt,
      sortBy,
      getSortClass
    };
  },

  template: `
    <div v-if="!isAuthenticated">
      <!-- Login Form -->
      <div class="login-container">
        <h3>Admin Login</h3>
        
        <!-- Dev Mode Indicator -->
        <div v-if="isLocalDevMode" class="dev-mode-banner">
          🔧 Local Development Mode
        </div>
        
        <div v-if="loginError" class="error-message">
          {{ loginError }}
        </div>
        
        <div class="form-group">
          <label for="username">Username</label>
          <input
            id="username"
            v-model="username"
            type="text"
            placeholder="Enter username"
            :class="{ error: loginError }"
            @keypress="handleLoginKeypress"
            autocomplete="username"
          />
        </div>
        
        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            placeholder="Enter password"
            :class="{ error: loginError }"
            @keypress="handleLoginKeypress"
            autocomplete="current-password"
          />
        </div>
        
        <button
          class="login-button"
          @click="login"
          :disabled="isLoggingIn"
        >
          {{ isLoggingIn ? 'Logging in...' : 'Login' }}
        </button>
      </div>
    </div>

    <div v-else>
      <!-- Admin Panel -->
      <div class="admin-container">
        <a href="/registration/" class="back-link">← Back to Registration</a>
        
        <div class="logout-container">
          <button class="logout-button" @click="logout">Logout</button>
        </div>
        
        <h3>Registration Approvals</h3>
        
        <div v-if="eventDate" class="event-date">
          <span class="event-date-label">Event Date:</span> {{ formatEventDate(eventDate) }}
          <span v-if="eventType"> ({{ eventType }})</span>
        </div>
        
        <!-- Success Message -->
        <div v-if="successMessage" class="success-message">
          {{ successMessage }}
        </div>
        
        <!-- Error Message -->
        <div v-if="error" class="error-message">
          <p><strong>Error:</strong></p>
          <p>{{ error }}</p>
        </div>
        
        <!-- Loading State -->
        <div v-if="loading" class="loading-message">
          Loading pending registrations...
        </div>
        
        <!-- Player Count -->
        <div v-if="!loading && !error" class="player-count">
          {{ playerCount }} pending registration{{ playerCount !== 1 ? 's' : '' }}
        </div>
        
        <!-- Empty State -->
        <div v-if="!loading && !error && playerCount === 0" class="empty-message">
          No pending registrations at this time.
        </div>
        
        <!-- Pending Players Table -->
        <div v-if="!loading && !error && playerCount > 0" class="pending-table-container">
          <table class="pending-table">
            <thead>
              <tr>
                <th :class="getSortClass('registered_at')" @click="sortBy('registered_at')">
                  Registered At
                </th>
                <th :class="getSortClass('first_name')" @click="sortBy('first_name')">
                  First Name
                </th>
                <th :class="getSortClass('last_name')" @click="sortBy('last_name')">
                  Last Name
                </th>
                <th :class="getSortClass('phone_number')" @click="sortBy('phone_number')">
                  Phone Number
                </th>
                <th :class="getSortClass('status')" @click="sortBy('status')">
                  Status
                </th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="player in pendingPlayers" :key="player.internal_user_id">
                <td>{{ formatRegisteredAt(player.registered_at) }}</td>
                <td>{{ player.first_name }}</td>
                <td>{{ player.last_name }}</td>
                <td>{{ player.phone_number || 'N/A' }}</td>
                <td>
                  <span
                    class="status-badge"
                    :class="{
                      'status-pending': !player.status || player.status.toLowerCase() === 'pending',
                      'status-pending-payment': player.status && player.status.toLowerCase() === 'pending_payment'
                    }"
                  >
                    {{ formatStatus(player.status) }}
                  </span>
                </td>
                <td>
                  <div class="action-buttons">
                    <button
                      class="confirm-button"
                      :class="{ processing: isProcessing(player) }"
                      @click="confirmPlayer(player)"
                      :disabled="isProcessing(player)"
                    >
                      {{ isProcessing(player) ? 'Confirming...' : 'Confirm' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
};

// Create and mount the Vue app
const app = createApp({
  components: {
    'admin-app': AdminApp
  },
  template: '<admin-app></admin-app>'
});

app.mount('#vue-admin-app');
