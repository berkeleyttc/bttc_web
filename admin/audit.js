// BTTC Admin - Registration Audit Panel
// Utilities loaded from bttc-utils.js: getErrorMessage, getFetchOptions, handleApiResponse
// Auth is handled by the shell (shell.js). This component assumes the user is authenticated.
// Vue globals (ref, computed, onMounted) are declared by shell.js.

const AuditPanel = {
  setup() {
    const entries = ref([]);
    const loading = ref(false);
    const error = ref(null);
    const activeFilter = ref('');
    const activeLimit = ref(50);

    const entryCount = computed(() => entries.value.length);
    const limitOptions = [50, 100, 200, 500];

    onMounted(() => {
      fetchAudit();
    });

    const fetchAudit = async () => {
      loading.value = true;
      error.value = null;
      try {
        const apiUrl = typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api';
        const params = new URLSearchParams();
        if (activeFilter.value) params.set('event_type', activeFilter.value);
        params.set('limit', activeLimit.value.toString());
        const url = `${apiUrl}/rr/registration-audit?${params.toString()}`;
        console.log('[AuditPanel] Fetching audit:', url);
        const response = await fetch(url, getFetchOptions());
        const data = await handleApiResponse(response);
        entries.value = data.entries || [];
        console.log(`[AuditPanel] Loaded ${entries.value.length} audit entries`);
      } catch (err) {
        console.error('[AuditPanel] Failed to fetch audit:', err);
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

    const formatDateTime = (dateStr) => {
      if (!dateStr) return 'N/A';
      try {
        return new Date(dateStr).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
          timeZone: typeof ENV !== 'undefined' ? ENV.TIMEZONE : 'America/Los_Angeles'
        });
      } catch (err) { return dateStr; }
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
      entries, loading, error, entryCount, activeFilter, activeLimit, limitOptions,
      fetchAudit, setFilter, setLimit,
      formatDateTime, eventLabel, eventBadgeClass, statusBadgeClass
    };
  },

  template: `
    <div class="admin-container audit-container">
      <h3>Registration Audit Log</h3>
      <p class="audit-subtitle">Who registered or unregistered for RR events, and when.</p>

      <div class="audit-controls">
        <div class="audit-filter-tabs">
          <button class="filter-tab" :class="{ active: activeFilter === '' }" @click="setFilter('')">All</button>
          <button class="filter-tab" :class="{ active: activeFilter === 'REGISTER_PLAYER' }" @click="setFilter('REGISTER_PLAYER')">Registrations</button>
          <button class="filter-tab" :class="{ active: activeFilter === 'UNREGISTER_PLAYER' }" @click="setFilter('UNREGISTER_PLAYER')">Unregistrations</button>
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

      <div v-if="error" class="error-message">
        <p><strong>Error:</strong></p>
        <p>{{ error }}</p>
      </div>

      <div v-if="loading" class="loading-message">Loading audit entries…</div>

      <div v-if="!loading && !error" class="player-count">
        {{ entryCount }} {{ entryCount === 1 ? 'entry' : 'entries' }}
      </div>

      <div v-if="!loading && !error && entryCount === 0" class="empty-message">
        No audit entries found.
      </div>

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
                <span :class="eventBadgeClass(entry.event_type)">{{ eventLabel(entry.event_type) }}</span>
              </td>
              <td>{{ entry.player_full_name || '—' }}</td>
              <td class="audit-cell-notes">{{ entry.notes || '—' }}</td>
              <td>
                <span :class="statusBadgeClass(entry.status)">{{ entry.status || '—' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `
};
