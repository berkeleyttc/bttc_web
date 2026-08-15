// BTTC Admin - Events Panel
// Open and close RR events. Replaces the manual `workflow_dispatch` trigger that went away
// when .github/workflows/open-event.yml and close-event.yml were retired.
// Utilities loaded from bttc-utils.js: getErrorMessage, getFetchOptions, handleApiResponse
// Auth is handled by the shell (shell.js). This component assumes the user is authenticated.
// Vue globals (ref, reactive, computed, onMounted) are declared by shell.js.

const EventsPanel = {
  setup() {
    const openEvents = ref([]);
    const loading = ref(false);
    const submitting = ref(false);
    const error = ref(null);
    const successMessage = ref('');
    // event_id awaiting a second click to confirm, and the one currently being closed
    const confirmingCloseId = ref(null);
    const closingId = ref(null);

    const eventTypes = [
      { value: 'rr', label: 'Round Robin' },
      { value: 'group_training', label: 'Group Training' },
      { value: 'tournament', label: 'Tournament' }
    ];

    const form = reactive({
      event_type: 'rr',
      event_date: '',
      // 66 matches settings.player_capacity in the API and the capacity the retired
      // open-event cron job posted. Note ENV.DEFAULT_PLAYER_CAP is 64 - the two are
      // out of sync; the field is editable until they're reconciled.
      max_capacity: 66,
      announcement_notes: ''
    });

    const eventCount = computed(() => openEvents.value.length);

    onMounted(() => {
      form.event_date = nextFridayISO();
      fetchOpenEvents();
    });

    const getApiUrl = () => (typeof ENV !== 'undefined' ? ENV.API_URL : '/.netlify/functions/api');

    // Today's date in the club's timezone, as YYYY-MM-DD ('en-CA' formats that way).
    const todayInTimezone = () => {
      const tz = typeof ENV !== 'undefined' ? ENV.TIMEZONE : 'America/Los_Angeles';
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    };

    // Upcoming Friday, strictly after today - today's own Friday rolls to next week.
    // Mirrors _next_friday() in the API's helpers/scheduler_helper.py.
    const nextFridayISO = () => {
      const [year, month, day] = todayInTimezone().split('-').map(Number);
      // Anchor to UTC so the weekday arithmetic can't be shifted by a DST boundary.
      const dt = new Date(Date.UTC(year, month - 1, day));
      let daysUntilFriday = (5 - dt.getUTCDay() + 7) % 7;
      if (daysUntilFriday === 0) daysUntilFriday = 7;
      dt.setUTCDate(dt.getUTCDate() + daysUntilFriday);
      return dt.toISOString().slice(0, 10);
    };

    const fetchOpenEvents = async () => {
      loading.value = true;
      error.value = null;
      confirmingCloseId.value = null;
      try {
        console.log('[EventsPanel] Fetching open events...');
        const response = await fetch(
          `${getApiUrl()}/events/all`,
          getFetchOptions({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'OPEN' })
          })
        );
        const data = await handleApiResponse(response);
        openEvents.value = Array.isArray(data) ? data : [];
        console.log(`[EventsPanel] Found ${openEvents.value.length} open event(s)`);
      } catch (err) {
        console.error('[EventsPanel] Failed to fetch open events:', err);
        error.value = getErrorMessage(err, 'loading open events');
      } finally {
        loading.value = false;
      }
    };

    const openEvent = async () => {
      error.value = null;

      if (!form.event_date) {
        showError('Please pick an event date.');
        return;
      }
      const capacity = Number(form.max_capacity);
      if (!Number.isInteger(capacity) || capacity <= 0) {
        showError('Max capacity must be a whole number greater than zero.');
        return;
      }

      const payload = {
        event_type: form.event_type,
        event_date: form.event_date,
        max_capacity: capacity
      };
      const notes = form.announcement_notes.trim();
      if (notes) payload.announcement_notes = notes;

      submitting.value = true;
      try {
        console.log('[EventsPanel] Opening event:', payload);
        const response = await fetch(
          `${getApiUrl()}/events/open`,
          getFetchOptions({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        );
        const data = await handleApiResponse(response);
        console.log('[EventsPanel] Event opened:', data);
        showSuccess(`Opened ${data.event_name || 'event'} for ${formatEventDate(data.event_date)}`);
        form.announcement_notes = '';
        await fetchOpenEvents();
      } catch (err) {
        console.error('[EventsPanel] Failed to open event:', err);
        showError(`Failed to open event: ${err.message}`);
      } finally {
        submitting.value = false;
      }
    };

    const requestClose = (event) => { confirmingCloseId.value = event.event_id; };
    const cancelClose = () => { confirmingCloseId.value = null; };

    const closeEvent = async (event) => {
      error.value = null;
      closingId.value = event.event_id;
      try {
        console.log('[EventsPanel] Closing event:', event.event_id);
        const response = await fetch(
          `${getApiUrl()}/events/close`,
          getFetchOptions({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_id: event.event_id })
          })
        );
        const data = await handleApiResponse(response);
        console.log('[EventsPanel] Event closed:', data);
        showSuccess(`Closed ${data.event_name || 'event'}`);
        await fetchOpenEvents();
      } catch (err) {
        console.error('[EventsPanel] Failed to close event:', err);
        showError(`Failed to close event: ${err.message}`);
      } finally {
        closingId.value = null;
        confirmingCloseId.value = null;
      }
    };

    const isClosing = (event) => closingId.value === event.event_id;
    const isConfirmingClose = (event) => confirmingCloseId.value === event.event_id;

    const showSuccess = (message) => {
      successMessage.value = message;
      setTimeout(() => { successMessage.value = ''; }, 3000);
    };

    const showError = (message) => { error.value = message; };

    const formatEventDate = (dateStr) => {
      if (!dateStr) return 'Not set';
      try {
        return new Date(dateStr).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
        });
      } catch (err) { return dateStr; }
    };

    const formatEventType = (type) => {
      const match = eventTypes.find(t => t.value === type);
      return match ? match.label : (type || '—');
    };

    return {
      openEvents, loading, submitting, error, successMessage, form, eventTypes, eventCount,
      fetchOpenEvents, openEvent, requestClose, cancelClose, closeEvent,
      isClosing, isConfirmingClose, formatEventDate, formatEventType
    };
  },

  template: `
    <div class="admin-container">
      <h3>Events</h3>
      <p class="audit-subtitle">Open the weekly event for registration, or close it when registration ends.</p>

      <div v-if="successMessage" class="success-message">{{ successMessage }}</div>

      <div v-if="error" class="error-message">
        <p><strong>Error:</strong></p>
        <p>{{ error }}</p>
      </div>

      <div class="event-form">
        <h4 class="event-form-title">Open an Event</h4>
        <div class="event-form-grid">
          <div class="form-group">
            <label for="event-type">Event Type</label>
            <select id="event-type" class="event-select" v-model="form.event_type">
              <option v-for="t in eventTypes" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label for="event-date">Event Date</label>
            <input id="event-date" type="date" v-model="form.event_date" />
          </div>
          <div class="form-group">
            <label for="event-capacity">Max Capacity</label>
            <input id="event-capacity" type="number" min="1" step="1" v-model.number="form.max_capacity" />
          </div>
        </div>
        <div class="form-group">
          <label for="event-notes">Announcement Notes <span class="optional-hint">(optional)</span></label>
          <textarea id="event-notes" class="event-textarea" rows="2" v-model="form.announcement_notes"
                    placeholder="Shown to players on the registration page"></textarea>
        </div>
        <button class="confirm-button" @click="openEvent" :disabled="submitting">
          {{ submitting ? 'Opening…' : 'Open Event' }}
        </button>
      </div>

      <div class="audit-controls">
        <h4 class="event-form-title">Currently Open</h4>
        <div class="audit-actions">
          <button class="refresh-button" @click="fetchOpenEvents" :disabled="loading">
            {{ loading ? 'Loading…' : '↻ Refresh' }}
          </button>
        </div>
      </div>

      <div v-if="loading" class="loading-message">Loading open events…</div>

      <div v-if="!loading" class="player-count">
        {{ eventCount }} open event{{ eventCount !== 1 ? 's' : '' }}
      </div>

      <div v-if="!loading && eventCount === 0" class="empty-message">
        No events are currently open.
      </div>

      <div v-if="!loading && eventCount > 0" class="pending-table-container">
        <table class="pending-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Type</th>
              <th>Date</th>
              <th>Capacity</th>
              <th>ID</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in openEvents" :key="event.event_id">
              <td>{{ event.event_name || '—' }}</td>
              <td>{{ formatEventType(event.event_type) }}</td>
              <td>{{ formatEventDate(event.event_date) }}</td>
              <td>{{ event.max_capacity }}</td>
              <td>{{ event.event_id }}</td>
              <td>
                <div class="action-buttons">
                  <template v-if="isConfirmingClose(event)">
                    <button class="close-button" @click="closeEvent(event)" :disabled="isClosing(event)">
                      {{ isClosing(event) ? 'Closing…' : 'Confirm close' }}
                    </button>
                    <button class="cancel-button" @click="cancelClose" :disabled="isClosing(event)">Cancel</button>
                  </template>
                  <button v-else class="close-button" @click="requestClose(event)">Close</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `
};
