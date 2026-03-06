// BTTC Admin Shell
// Handles authentication and top-level tool navigation.
// Each tool is a self-contained component defined in its own file.
// Load order in index.html: admin.js → audit.js → shell.js

const { createApp, ref, reactive, computed, onMounted } = Vue;

const AUTH_KEY = 'bttc_admin_auth';
const AUTH_TOKEN_KEY = 'bttc_admin_token';
const AUTH_EXPIRES_KEY = 'bttc_admin_expires';

const AdminShell = {
  components: {
    'approvals-panel': ApprovalsPanel,
    'audit-panel': AuditPanel
  },
  setup() {
    const isAuthenticated = ref(false);
    const username = ref('');
    const password = ref('');
    const loginError = ref('');
    const isLoggingIn = ref(false);
    const isLocalDevMode = ref(false);
    const activeTab = ref('approvals');

    onMounted(() => {
      const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';
      isLocalDevMode.value = apiUrl.includes('localhost') || apiUrl.includes('0.0.0.0') || apiUrl.includes('127.0.0.1');
      checkAuth();
    });

    const checkAuth = () => {
      try {
        const isAuth = sessionStorage.getItem(AUTH_KEY);
        const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
        const expires = sessionStorage.getItem(AUTH_EXPIRES_KEY);
        if (isAuth === 'true' && token && expires) {
          const expiresAt = parseInt(expires, 10);
          if (Date.now() < expiresAt) {
            isAuthenticated.value = true;
            return;
          }
        }
        clearAuth();
      } catch (err) {
        console.error('[AdminShell] Failed to check auth:', err);
        clearAuth();
      }
    };

    const clearAuth = () => {
      try {
        sessionStorage.removeItem(AUTH_KEY);
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        sessionStorage.removeItem(AUTH_EXPIRES_KEY);
      } catch (err) {
        console.error('[AdminShell] Failed to clear auth:', err);
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
          } else {
            loginError.value = data.message || 'Invalid username or password.';
          }
        }
      } catch (err) {
        console.error('[AdminShell] Login error:', err);
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
      loginError.value = '';
    };

    const handleLoginKeypress = (event) => {
      if (event.key === 'Enter') login();
    };

    return {
      isAuthenticated,
      username,
      password,
      loginError,
      isLoggingIn,
      isLocalDevMode,
      activeTab,
      login,
      logout,
      handleLoginKeypress
    };
  },

  template: `
    <div v-if="!isAuthenticated">
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

    <div v-else class="admin-shell">
      <div class="admin-shell-header">
        <nav class="admin-tabs">
          <button
            class="admin-tab"
            :class="{ active: activeTab === 'approvals' }"
            @click="activeTab = 'approvals'"
          >Registration Approvals</button>
          <button
            class="admin-tab"
            :class="{ active: activeTab === 'audit' }"
            @click="activeTab = 'audit'"
          >Audit Log</button>
        </nav>
        <button class="logout-button" @click="logout">Logout</button>
      </div>

      <approvals-panel v-if="activeTab === 'approvals'"></approvals-panel>
      <audit-panel v-if="activeTab === 'audit'"></audit-panel>
    </div>
  `
};

const app = createApp({
  components: { 'admin-shell': AdminShell },
  template: '<admin-shell></admin-shell>'
});

app.mount('#vue-admin-app');
