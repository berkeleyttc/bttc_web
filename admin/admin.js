// BTTC Admin - Registration Approvals Panel
// Utilities loaded from bttc-utils.js: getErrorMessage, getFetchOptions, handleApiResponse
// Auth is handled by the shell (shell.js). This component assumes the user is authenticated.
// Vue globals (ref, reactive, computed, onMounted) are declared by shell.js.

const ApprovalsPanel = {
  setup() {
    const players = ref([]);
    const loading = ref(false);
    const error = ref(null);
    const eventDate = ref('');
    const eventType = ref('');
    const successMessage = ref('');
    const processingPlayers = ref(new Set());
    const currentSort = reactive({
      key: 'registered_at',
      direction: 'desc'
    });

    const pendingPlayers = computed(() => {
      const filtered = players.value.filter(p => {
        if (!p.status || p.status === null || p.status === undefined) return true;
        const status = p.status.toString().toLowerCase();
        return status === 'pending' || status === 'pending_payment';
      });
      return sortPlayers(filtered);
    });

    const playerCount = computed(() => pendingPlayers.value.length);

    onMounted(() => {
      fetchPlayers();
    });

    const fetchPlayers = async () => {
      loading.value = true;
      error.value = null;
      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';
        console.log('[ApprovalsPanel] Fetching roster...');
        const response = await fetch(`${apiUrl}/rr/roster?include_id=true`, getFetchOptions());
        const data = await handleApiResponse(response);
        players.value = data.roster || [];
        eventDate.value = data.event_date || '';
        eventType.value = data.event_type || '';
        console.log(`[ApprovalsPanel] Found ${pendingPlayers.value.length} pending players`);
      } catch (err) {
        console.error('[ApprovalsPanel] Failed to fetch players:', err);
        error.value = getErrorMessage(err, 'fetching pending registrations');
      } finally {
        loading.value = false;
      }
    };

    const confirmPlayer = async (player) => {
      if (!player.internal_user_id) {
        showError('Cannot confirm player: Missing user ID');
        return;
      }
      processingPlayers.value.add(player.internal_user_id);
      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';
        console.log('[ApprovalsPanel] Confirming player:', player.internal_user_id);
        const response = await fetch(
          `${apiUrl}/rr/registration/confirm`,
          getFetchOptions({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ internal_user_id: player.internal_user_id })
          })
        );
        const data = await handleApiResponse(response);
        console.log('[ApprovalsPanel] Player confirmed:', data);
        const playerName = player.full_name || `${player.first_name} ${player.last_name}`;
        showSuccess(`Successfully confirmed ${playerName}`);
        await fetchPlayers();
      } catch (err) {
        console.error('[ApprovalsPanel] Failed to confirm player:', err);
        const playerName = player.full_name || `${player.first_name} ${player.last_name}`;
        showError(`Failed to confirm ${playerName}: ${err.message}`);
      } finally {
        processingPlayers.value.delete(player.internal_user_id);
      }
    };

    const sortPlayers = (playerList) => {
      if (!currentSort.key || playerList.length === 0) return playerList;
      const key = currentSort.key;
      return [...playerList].sort((a, b) => {
        let valA = a[key] || '';
        let valB = b[key] || '';
        if (key === 'registered_at') {
          valA = new Date(valA);
          valB = new Date(valB);
        } else if (key === 'status') {
          valA = (a.status ?? 'pending').toString().toLowerCase();
          valB = (b.status ?? 'pending').toString().toLowerCase();
        } else {
          valA = valA.toString().toLowerCase();
          valB = valB.toString().toLowerCase();
        }
        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
      });
    };

    const sortBy = (key) => {
      if (currentSort.key === key) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
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
      setTimeout(() => { successMessage.value = ''; }, 3000);
    };

    const showError = (message) => { error.value = message; };

    const isProcessing = (player) => processingPlayers.value.has(player.internal_user_id);

    const formatStatus = (status) => {
      if (!status) return 'Pending';
      if (status === 'PENDING_PAYMENT') return 'Pending Payment';
      return status.charAt(0) + status.slice(1).toLowerCase();
    };

    const formatEventDate = (dateStr) => {
      if (!dateStr) return 'Not set';
      try {
        return new Date(dateStr).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
        });
      } catch (err) { return dateStr; }
    };

    const formatRegisteredAt = (dateStr) => {
      if (!dateStr) return 'N/A';
      try {
        return new Date(dateStr).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles'
        });
      } catch (err) { return dateStr; }
    };

    return {
      players, loading, error, eventDate, eventType, successMessage, currentSort,
      pendingPlayers, playerCount,
      fetchPlayers, confirmPlayer, isProcessing,
      formatStatus, formatEventDate, formatRegisteredAt,
      sortBy, getSortClass
    };
  },

  template: `
    <div class="admin-container">
      <a href="/registration/" class="back-link">← Back to Registration</a>

      <h3>Registration Approvals</h3>

      <div v-if="eventDate" class="event-date">
        <span class="event-date-label">Event Date:</span> {{ formatEventDate(eventDate) }}
        <span v-if="eventType"> ({{ eventType }})</span>
      </div>

      <div v-if="successMessage" class="success-message">{{ successMessage }}</div>

      <div v-if="error" class="error-message">
        <p><strong>Error:</strong></p>
        <p>{{ error }}</p>
      </div>

      <div v-if="loading" class="loading-message">Loading pending registrations...</div>

      <div v-if="!loading && !error" class="player-count">
        {{ playerCount }} pending registration{{ playerCount !== 1 ? 's' : '' }}
      </div>

      <div v-if="!loading && !error && playerCount === 0" class="empty-message">
        No pending registrations at this time.
      </div>

      <div v-if="!loading && !error && playerCount > 0" class="pending-table-container">
        <table class="pending-table">
          <thead>
            <tr>
              <th :class="getSortClass('registered_at')" @click="sortBy('registered_at')">Registered At</th>
              <th :class="getSortClass('first_name')" @click="sortBy('first_name')">First Name</th>
              <th :class="getSortClass('last_name')" @click="sortBy('last_name')">Last Name</th>
              <th :class="getSortClass('phone_number')" @click="sortBy('phone_number')">Phone Number</th>
              <th :class="getSortClass('status')" @click="sortBy('status')">Status</th>
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
                >{{ formatStatus(player.status) }}</span>
              </td>
              <td>
                <div class="action-buttons">
                  <button
                    class="confirm-button"
                    :class="{ processing: isProcessing(player) }"
                    @click="confirmPlayer(player)"
                    :disabled="isProcessing(player)"
                  >{{ isProcessing(player) ? 'Confirming...' : 'Confirm' }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `
};
