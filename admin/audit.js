// BTTC Admin Registration Audit Page
// Utilities loaded from bttc-utils.js: getErrorMessage, getFetchOptions, handleApiResponse

const { createApp, ref, computed, onMounted } = Vue;

// Session storage keys (shared with admin panel)
const AUTH_KEY = 'bttc_admin_auth';
const AUTH_TOKEN_KEY = 'bttc_admin_token';
const AUTH_EXPIRES_KEY = 'bttc_admin_expires';

const AuditApp = {
  setup() {
    // Authentication state
    const isAuthenticated = ref(false);
    const username = ref('');
    const password = ref('');
    const loginError = ref('');
    const isLoggingIn = ref(false);
    const isLocalDevMode = ref(false);

    // Data state
    const entries = ref([]);
    const loading = ref(false);
    const error = ref(null);
    const activeFilter = ref('');   // '' = all, 'REGISTER_PLAYER', 'UNREGISTER_PLAYER'
    const activeLimit = ref(50);

    // Computed
    const entryCount = computed(() => entries.value.length);

    const limitOptions = [50, 100, 200, 500];

    // Check if already authenticated on mount
    onMounted(() => {
      const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';
      isLocalDevMode.value = apiUrl.includes('localhost') || apiUrl.includes('0.0.0.0') || apiUrl.includes('127.0.0.1');
      checkAuth();
    });

    // ── Authentication ──────────────────────────────────────────────

    const checkAuth = () => {
      try {
        const isAuth = sessionStorage.getItem(AUTH_KEY);
        const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
        const expires = sessionStorage.getItem(AUTH_EXPIRES_KEY);

        if (isAuth === 'true' && token && expires) {
          const expiresAt = parseInt(expires, 10);
          if (Date.now() < expiresAt) {
            isAuthenticated.value = true;
            fetchAudit();
            return;
          }
        }
        clearAuth();
      } catch (err) {
        console.error('[AuditApp] Failed to check auth:', err);
        clearAuth();
      }
    };

    const clearAuth = () => {
      try {
        sessionStorage.removeItem(AUTH_KEY);
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        sessionStorage.removeItem(AUTH_EXPIRES_KEY);
      } catch (err) {
        console.error('[AuditApp] Failed to clear auth:', err);
      }
    };

    const login = async () => {
      loginError.value = '';
      isLoggingIn.value = true;

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
        const isLocalDev = apiUrl.includes('localhost') || apiUrl.includes('0.0.0.0') || apiUrl.includes('127.0.0.1');
        isLocalDevMode.value = isLocalDev;

        if (isLocalDev) {
          const localUsername = typeof ENV !== 'undefined' ? ENV.ADMIN_USERNAME : 'admin';
          const localPassword = typeof ENV !== 'undefined' ? ENV.ADMIN_PASSWORD : 'bttc2024';

          if (username.value.trim() === localUsername && password.value === localPassword) {
            const mockToken = 'local-dev-token-' + Date.now();
            const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
            sessionStorage.setItem(AUTH_KEY, 'true');
            sessionStorage.setItem(AUTH_TOKEN_KEY, mockToken);
            sessionStorage.setItem(AUTH_EXPIRES_KEY, expiresAt.toString());
            isAuthenticated.value = true;
            password.value = '';
            await fetchAudit();
          } else {
            loginError.value = 'Invalid username or password.';
          }
        } else {
          const baseUrl = apiUrl.replace('/rr', '').replace('/api', '');
          const response = await fetch(`${baseUrl}/admin-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username.value.trim(), password: password.value })
          });
          const data = await response.json();

          if (response.ok && data.success) {
            sessionStorage.setItem(AUTH_KEY, 'true');
            sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
            sessionStorage.setItem(AUTH_EXPIRES_KEY, data.expiresAt.toString());
            isAuthenticated.value = true;
            password.value = '';
            await fetchAudit();
          } else {
            loginError.value = data.message || 'Invalid username or password.';
          }
        }
      } catch (err) {
        console.error('[AuditApp] Login error:', err);
        loginError.value = 'Unable to connect to authentication server. Please try again.';
      } finally {
        isLoggingIn.value = false;
      }
    };

    const logout = () => {
      clearAuth();
      isAuthenticated.value = false;
      username.value = '';
      password.value = '';
      entries.value = [];
      error.value = null;
      loginError.value = '';
    };

    const handleLoginKeypress = (event) => {
      if (event.key === 'Enter') login();
    };

    // ── Data fetching ───────────────────────────────────────────────

    const fetchAudit = async () => {
      loading.value = true;
      error.value = null;

      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';

        const params = new URLSearchParams();
        if (activeFilter.value) params.set('event_type', activeFilter.value);
        params.set('limit', activeLimit.value.toString());

        const url = `${apiUrl}/rr/registration-audit?${params.toString()}`;
        console.log('[AuditApp] Fetching audit:', url);

        const response = await fetch(url, getFetchOptions());
        const data = await handleApiResponse(response);

        entries.value = data.entries || [];
        console.log(`[AuditApp] Loaded ${entries.value.length} audit entries`);
      } catch (err) {
        console.error('[AuditApp] Failed to fetch audit:', err);
        error.value = getErrorMessage(err, 'loading registration audit');
      } finally {
        loading.value = false;
      }
    };

    const setFilter = async (filter) => {
      if (activeFilter.value === filter) return;
      activeFilter.value = filter;
      await fetchAudit();
    };

    const setLimit = async (limit) => {
      if (activeLimit.value === limit) return;
      activeLimit.value = limit;
      await fetchAudit();
    };

    // ── Formatting helpers ──────────────────────────────────────────

    const formatDateTime = (dateStr) => {
      if (!dateStr) return 'N/A';
      try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: typeof ENV !== 'undefined' ? ENV.TIMEZONE : 'America/Los_Angeles'
        });
      } catch (err) {
        return dateStr;
      }
    };

    const formatPhone = (phone) => {
      if (!phone) return '—';
      const digits = phone.replace(/\D/g, '');
      if (digits.length === 10) {
        return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
      }
      return phone;
    };

    const eventLabel = (eventType) => {
      if (eventType === 'REGISTER_PLAYER') return 'Registered';
      if (eventType === 'UNREGISTER_PLAYER') return 'Unregistered';
      return eventType || '—';
    };

    const eventBadgeClass = (eventType) => {
      if (eventType === 'REGISTER_PLAYER') return 'event-badge event-badge-register';
      if (eventType === 'UNREGISTER_PLAYER') return 'event-badge event-badge-unregister';
      return 'event-badge';
    };

    const statusBadgeClass = (status) => {
      if (!status) return 'status-badge status-unknown';
      const s = status.toUpperCase();
      if (s === 'SUCCESS') return 'status-badge status-success';
      if (s === 'FAILED') return 'status-badge status-failed';
      return 'status-badge status-unknown';
    };

    return {
      // Auth
      isAuthenticated,
      username,
      password,
      loginError,
      isLoggingIn,
      isLocalDevMode,
      login,
      logout,
      handleLoginKeypress,

      // Data
      entries,
      loading,
      error,
      entryCount,
      activeFilter,
      activeLimit,
      limitOptions,

      // Actions
      fetchAudit,
      setFilter,
      setLimit,

      // Formatters
      formatDateTime,
      formatPhone,
      eventLabel,
      eventBadgeClass,
      statusBadgeClass
    };
  },

  template: `
    <div v-if="!isAuthenticated">
      <!-- Login Form -->
      <div class="login-container">
        <h3>Admin Login</h3>

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

        <button class="login-button" @click="login" :disabled="isLoggingIn">
          {{ isLoggingIn ? 'Logging in...' : 'Login' }}
        </button>
      </div>
    </div>

    <div v-else>
      <!-- Audit Panel -->
      <div class="admin-container audit-container">

        <!-- Top bar: nav link + logout -->
        <div class="audit-topbar">
          <a href="/admin/" class="back-link">← Registration Approvals</a>
          <button class="logout-button" @click="logout">Logout</button>
        </div>

        <h3>Registration Audit Log</h3>
        <p class="audit-subtitle">Who registered or unregistered for RR events, and when.</p>

        <!-- Controls: filter tabs + limit + refresh -->
        <div class="audit-controls">
          <div class="audit-filter-tabs">
            <button
              class="filter-tab"
              :class="{ active: activeFilter === '' }"
              @click="setFilter('')"
            >All</button>
            <button
              class="filter-tab"
              :class="{ active: activeFilter === 'REGISTER_PLAYER' }"
              @click="setFilter('REGISTER_PLAYER')"
            >Registrations</button>
            <button
              class="filter-tab"
              :class="{ active: activeFilter === 'UNREGISTER_PLAYER' }"
              @click="setFilter('UNREGISTER_PLAYER')"
            >Unregistrations</button>
          </div>

          <div class="audit-actions">
            <select class="limit-select" :value="activeLimit" @change="setLimit(Number($event.target.value))">
              <option v-for="opt in limitOptions" :key="opt" :value="opt">Last {{ opt }}</option>
            </select>
            <button class="refresh-button" @click="fetchAudit" :disabled="loading">
              {{ loading ? 'Loading…' : '↻ Refresh' }}
            </button>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="error" class="error-message">
          <p><strong>Error:</strong></p>
          <p>{{ error }}</p>
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="loading-message">
          Loading audit entries…
        </div>

        <!-- Entry count -->
        <div v-if="!loading && !error" class="player-count">
          {{ entryCount }} {{ entryCount === 1 ? 'entry' : 'entries' }}
        </div>

        <!-- Empty State -->
        <div v-if="!loading && !error && entryCount === 0" class="empty-message">
          No audit entries found.
        </div>

        <!-- Audit Table -->
        <div v-if="!loading && !error && entryCount > 0" class="pending-table-container">
          <table class="pending-table audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Player Name</th>
                <th>Notes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(entry, idx) in entries" :key="idx">
                <td class="audit-cell-time">{{ formatDateTime(entry.created_at) }}</td>
                <td>
                  <span :class="eventBadgeClass(entry.event_type)">
                    {{ eventLabel(entry.event_type) }}
                  </span>
                </td>
                <td>{{ entry.player_full_name || '—' }}</td>
                <td class="audit-cell-notes">{{ entry.notes || '—' }}</td>
                <td>
                  <span :class="statusBadgeClass(entry.status)">
                    {{ entry.status || '—' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  `
};

const app = createApp({
  components: { 'audit-app': AuditApp },
  template: '<audit-app></audit-app>'
});

app.mount('#vue-audit-app');
