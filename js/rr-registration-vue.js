/**
 * BTTC Round Robin Registration - Vue.js Version
 * Converted from vanilla JavaScript to Vue.js 3
 */

const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

// ========================================
// REGISTRATION STATUS COMPONENT
// ========================================
const RegistrationStatus = {
  props: {
    isOpen: Boolean,
    closingTime: String,
    nextOpening: String,
    devMode: Boolean
  },
  template: `
    <div class="status-banner" :class="statusClass">
      <div v-if="isOpen">
        🟢 Registration is OPEN<span v-if="devMode"> (DEV MODE)</span>
      </div>
      <div v-else>
        🔴 Registration is CLOSED
      </div>
      <div class="status-details">
        <span v-if="isOpen && !devMode">Closes today at {{ closingTime }} PST</span>
        <span v-else-if="isOpen && devMode">Developer override active</span>
        <span v-else>Next opening: {{ nextOpening }} PST</span>
      </div>
    </div>
  `,
  computed: {
    statusClass() {
      return this.isOpen ? 'status-open' : 'status-closed';
    }
  }
};

// ========================================
// CAPACITY BANNER COMPONENT
// ========================================
const CapacityBanner = {
  props: {
    capacity: Object
  },
  template: `
    <div class="capacity-banner" :class="capacityClass">
      <div v-if="capacity.isAtCapacity">
        🔴 Registration is FULL
      </div>
      <div v-else>
        🟢 {{ capacity.spotsAvailable }} spots available
      </div>
      <div class="status-details">
        {{ capacity.confirmedCount }}/{{ capacity.playerCap }} spots filled
      </div>
    </div>
  `,
  computed: {
    capacityClass() {
      return this.capacity.isAtCapacity ? 'capacity-full' : 'capacity-available';
    }
  }
};

// ========================================
// PLAYER LOOKUP COMPONENT
// ========================================
const PlayerLookup = {
  props: {
    registrationOpen: Boolean
  },
  emits: ['player-found', 'lookup-error'],
  setup(props, { emit }) {
    const phoneInput = ref('');
    const isLookingUp = ref(false);

    const handleSubmit = async (e) => {
      e.preventDefault();
      
      if (!props.registrationOpen) {
        alert('Registration is currently closed. Please check the status banner above for when it will reopen.');
        return;
      }

      const phone = phoneInput.value.trim().replace(/^1|\D/g, '');
      
      if (!phone) {
        emit('lookup-error', 'Please enter a phone number.');
        return;
      }

      isLookingUp.value = true;
      
      try {
        const response = await fetch(`${config.scriptUrl}/rr/search?phone=${encodeURIComponent(phone)}`);
        const data = await response.json();
        emit('player-found', data);
      } catch (error) {
        emit('lookup-error', `An error occurred: ${error.message}`);
      } finally {
        isLookingUp.value = false;
      }
    };

    return {
      phoneInput,
      isLookingUp,
      handleSubmit
    };
  },
  template: `
    <div class="registration-content">
      <p>Enter your phone number (e.g., 5101234567):</p>
      <form @submit="handleSubmit">
        <input 
          v-model="phoneInput"
          type="tel" 
          maxlength="16" 
          placeholder="Enter phone number" 
          required 
        />
        <button type="submit" :disabled="isLookingUp">
          {{ isLookingUp ? 'Looking up...' : 'Lookup' }}
        </button>
      </form>
    </div>
  `
};

// ========================================
// PLAYER LIST COMPONENT
// ========================================
const PlayerList = {
  props: {
    players: Array,
    capacity: Object
  },
  emits: ['register-player', 'unregister-player'],
  setup(props, { emit }) {
    const registerPlayer = (index) => {
      emit('register-player', index);
    };

    const unregisterPlayer = (index) => {
      emit('unregister-player', index);
    };

    return {
      registerPlayer,
      unregisterPlayer
    };
  },
  template: `
    <div v-if="players.length > 0" class="result">
      <p class="success">Manage your registration:</p>
      <capacity-banner :capacity="capacity" />
      
      <div v-for="(player, index) in players" :key="player.bttc_id" class="entry">
        <div v-if="player.is_registered">
          <p style="color: gray;">
            {{ player.first_name }} {{ player.last_name }} 
            <span style="font-weight: bold;">(Already registered)</span>
          </p>
          <div class="unregister-form">
            <input 
              type="text" 
              :placeholder="'Enter your PIN'"
              class="token-field" 
              v-model="player.unregisterToken"
            />
            <button 
              style="background-color: #dc3545;" 
              class="confirm-btn" 
              @click="unregisterPlayer(index)"
            >
              Unregister
            </button>
            <span class="token-error" v-if="player.unregisterError">{{ player.unregisterError }}</span>
          </div>
        </div>
        <div v-else>
          <p v-if="capacity.isAtCapacity" style="color: #666;">
            {{ player.first_name }} {{ player.last_name }}
          </p>
          <p v-else>
            {{ player.first_name }} {{ player.last_name }}
          </p>
          
          <div v-if="capacity.isAtCapacity" class="register-form">
            <p class="registration-full-message">
              ❌ Registration is full ({{ capacity.confirmedCount }}/{{ capacity.playerCap }})
            </p>
          </div>
          <div v-else class="register-form">
            <input 
              type="text" 
              :placeholder="'Enter your PIN'"
              class="token-field" 
              v-model="player.registerToken"
            />
            <button 
              class="confirm-btn" 
              @click="registerPlayer(index)"
            >
              Register
            </button>
            <span class="token-error" v-if="player.registerError">{{ player.registerError }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
  components: {
    CapacityBanner
  }
};

// ========================================
// REGISTRATION DIALOG COMPONENT
// ========================================
const RegistrationDialog = {
  props: {
    show: Boolean,
    player: Object
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    const paymentMethod = ref('');
    const comments = ref('');

    const handleConfirm = () => {
      if (!paymentMethod.value) {
        alert('Please select a payment method.');
        return;
      }

      emit('confirm', {
        paymentMethod: paymentMethod.value,
        comments: comments.value
      });
    };

    const handleClose = () => {
      paymentMethod.value = '';
      comments.value = '';
      emit('close');
    };

    return {
      paymentMethod,
      comments,
      handleConfirm,
      handleClose
    };
  },
  template: `
    <div v-if="show" class="dialog-overlay" @click="handleClose">
      <div class="dialog-box" @click.stop>
        <div class="dialog-title">Complete Registration</div>

        <div class="payment-options">
          <h4>Payment Method:</h4>
          <div class="radio-option">
            <input 
              type="radio" 
              id="payByCash" 
              name="paymentMethod" 
              value="cash"
              v-model="paymentMethod"
            />
            <label for="payByCash">Pay by Cash</label>
          </div>
          <div class="radio-option">
            <input 
              type="radio" 
              id="payByDigital" 
              name="paymentMethod" 
              value="zelle_venmo"
              v-model="paymentMethod"
            />
            <label for="payByDigital">Pay by Zelle/Venmo</label>
          </div>
        </div>

        <div class="comments-section">
          <h4>Comments (optional):</h4>
          <textarea 
            v-model="comments"
            placeholder="Enter any comments or special requests..."
          ></textarea>
        </div>

        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-cancel" @click="handleClose">Cancel</button>
          <button class="dialog-btn dialog-btn-ok" @click="handleConfirm">Register</button>
        </div>
      </div>
    </div>
  `
};

// ========================================
// UNREGISTRATION DIALOG COMPONENT
// ========================================
const UnregistrationDialog = {
  props: {
    show: Boolean,
    player: Object
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    const comments = ref('');

    const handleConfirm = () => {
      emit('confirm', {
        comments: comments.value
      });
    };

    const handleClose = () => {
      comments.value = '';
      emit('close');
    };

    return {
      comments,
      handleConfirm,
      handleClose
    };
  },
  template: `
    <div v-if="show" class="dialog-overlay" @click="handleClose">
      <div class="dialog-box" @click.stop>
        <div class="dialog-title">Confirm Unregistration</div>

        <div class="comments-section">
          <h4>Reason for unregistering (optional):</h4>
          <textarea 
            v-model="comments"
            placeholder="Please let us know why you're unregistering..."
          ></textarea>
        </div>

        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-cancel" @click="handleClose">Cancel</button>
          <button class="dialog-btn dialog-btn-ok" @click="handleConfirm">Unregister</button>
        </div>
      </div>
    </div>
  `
};

// ========================================
// MAIN REGISTRATION APP COMPONENT
// ========================================
const RegistrationApp = {
  components: {
    RegistrationStatus,
    PlayerLookup,
    PlayerList,
    RegistrationDialog,
    UnregistrationDialog
  },
  setup() {
    // Reactive state
    const players = ref([]);
    const registrationOpen = ref(false);
    const capacity = ref({
      isAtCapacity: false,
      confirmedCount: 0,
      playerCap: 65,
      spotsAvailable: 0
    });
    const showRegistrationDialog = ref(false);
    const showUnregistrationDialog = ref(false);
    const currentRegistrationData = ref(null);
    const currentUnregistrationData = ref(null);
    const error = ref('');
    const devOverride = true; // Keep the same dev override logic

    // Computed properties
    const closingTime = computed(() => {
      const now = new Date();
      const pstNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
      const closingTime = new Date(pstNow);
      closingTime.setHours(18, 45, 0, 0);
      return closingTime.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        hour: 'numeric',
        minute: '2-digit'
      });
    });

    const nextOpening = computed(() => {
      const now = new Date();
      const pstNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
      const dayOfWeek = pstNow.getDay();
      
      let daysUntilFriday;
      if (dayOfWeek === 5) {
        daysUntilFriday = 7;
      } else {
        daysUntilFriday = (5 - dayOfWeek + 7) % 7;
        if (daysUntilFriday === 0) daysUntilFriday = 7;
      }

      const nextFriday = new Date(pstNow);
      nextFriday.setDate(nextFriday.getDate() + daysUntilFriday);
      nextFriday.setHours(0, 0, 0, 0);

      return nextFriday.toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    });

    // Methods
    const isRegistrationOpen = () => {
      if (devOverride) return true;

      const now = new Date();
      const pstNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
      const dayOfWeek = pstNow.getDay();
      const hours = pstNow.getHours();
      const minutes = pstNow.getMinutes();

      if (dayOfWeek === 5) {
        if (hours < 18 || (hours === 18 && minutes <= 45)) {
          return true;
        }
      }
      return false;
    };

    const checkRegistrationStatus = () => {
      registrationOpen.value = isRegistrationOpen();
    };

    const checkRegistrationCapacity = async () => {
      try {
        const response = await fetch(`${config.scriptUrl}/rr/capacity`, { method: 'POST' });
        const data = await response.json();
        capacity.value = {
          isAtCapacity: !!data.roster_full,
          confirmedCount: Number(data.confirmed_count || 0),
          playerCap: Number(data.player_cap || 65),
          spotsAvailable: Number(data.spots_available || 0),
          eventOpen: !!data.event_open
        };
      } catch (err) {
        console.error('Error checking capacity:', err);
        capacity.value = { isAtCapacity: false, confirmedCount: 0, playerCap: 65, spotsAvailable: 0, eventOpen: false };
      }
    };

    const handlePlayerFound = (data) => {
      if (data.result === "None" || data.length === 0) {
        error.value = 'No player found for this phone number.';
        players.value = [];
        return;
      }

      error.value = '';
      players.value = data.map(player => ({
        ...player,
        registerToken: '',
        unregisterToken: '',
        registerError: '',
        unregisterError: ''
      }));
      
      checkRegistrationCapacity();
    };

    const handleLookupError = (errorMessage) => {
      error.value = errorMessage;
      players.value = [];
    };

    const handleRegisterPlayer = (index) => {
      if (!registrationOpen.value) {
        alert('Registration is currently closed.');
        return;
      }

      if (capacity.value.isAtCapacity) {
        alert(`Registration is full! All ${capacity.value.playerCap} spots have been taken.`);
        return;
      }

      const player = players.value[index];
      if (!player.registerToken) {
        player.registerError = "Please enter your PIN.";
        return;
      }

      currentRegistrationData.value = { player, index };
      showRegistrationDialog.value = true;
    };

    const handleUnregisterPlayer = (index) => {
      const player = players.value[index];
      if (!player.unregisterToken) {
        player.unregisterError = "Please enter your PIN.";
        return;
      }

      currentUnregistrationData.value = { player, index };
      showUnregistrationDialog.value = true;
    };

    const confirmRegistration = async (data) => {
      const { player, index } = currentRegistrationData.value;
      
      try {
        const payload = {
          bttc_id: player.bttc_id,
          first_name: player.first_name,
          last_name: player.last_name,
          token: player.registerToken,
          payment_method: data.paymentMethod,
          comments: data.comments
        };

        const response = await fetch(`${config.scriptUrl}/rr/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (result.success) {
          alert(result.message);
          showRegistrationDialog.value = false;
          players.value = [];
          error.value = '';
        } else {
          if (result.isAtCapacity) {
            alert(`Registration is full! All ${result.playerCap} spots have been taken.`);
          } else {
            players.value[index].registerError = result.message;
          }
          showRegistrationDialog.value = false;
        }
      } catch (err) {
        players.value[index].registerError = "Failed to register: " + err.message;
        showRegistrationDialog.value = false;
      }
    };

    const confirmUnregistration = async (data) => {
      const { player, index } = currentUnregistrationData.value;
      
      try {
        const payload = {
          bttc_id: player.bttc_id,
          first_name: player.first_name,
          last_name: player.last_name,
          token: player.unregisterToken,
          comments: data.comments
        };

        const response = await fetch(`${config.scriptUrl}/rr/unregister`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (result.success) {
          alert(result.message);
          showUnregistrationDialog.value = false;
          // Refresh the display
          const phone = document.querySelector('input[type="tel"]')?.value?.trim().replace(/^1|\D/g, '');
          if (phone) {
            handlePlayerFound(await fetch(`${config.scriptUrl}/rr/search?phone=${encodeURIComponent(phone)}`).then(r => r.json()));
          }
        } else {
          players.value[index].unregisterError = result.message;
          showUnregistrationDialog.value = false;
        }
      } catch (err) {
        players.value[index].unregisterError = "Failed to unregister: " + err.message;
        showUnregistrationDialog.value = false;
      }
    };

    // Lifecycle
    onMounted(() => {
      checkRegistrationStatus();
      
      if (devOverride) {
        console.log('🔧 Developer mode enabled - time restrictions bypassed');
        const devIndicator = document.createElement('div');
        devIndicator.innerHTML = '🔧 DEV MODE - Time restrictions disabled';
        devIndicator.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff6b6b;color:white;text-align:center;padding:5px;font-weight:bold;z-index:9999;';
        document.body.prepend(devIndicator);
      }
    });

    return {
      players,
      registrationOpen,
      capacity,
      showRegistrationDialog,
      showUnregistrationDialog,
      currentRegistrationData,
      currentUnregistrationData,
      error,
      devOverride,
      closingTime,
      nextOpening,
      handlePlayerFound,
      handleLookupError,
      handleRegisterPlayer,
      handleUnregisterPlayer,
      confirmRegistration,
      confirmUnregistration
    };
  },
  template: `
    <div class="container" :class="{ 'registration-disabled': !registrationOpen }">
      <h2 style="font-family: Arial, sans-serif; font-weight: bold;">Round Robin Sign-Up</h2>

      <registration-status 
        :is-open="registrationOpen"
        :closing-time="closingTime"
        :next-opening="nextOpening"
        :dev-mode="devOverride"
      />

      <player-lookup 
        :registration-open="registrationOpen"
        @player-found="handlePlayerFound"
        @lookup-error="handleLookupError"
      />

      <div v-if="error" class="result">
        <p class="error">{{ error }}</p>
        <a href="player_signup.html" class="signup-link">
          PLAYER INFO SIGNUP
        </a>
        <p>Otherwise Contact BTTC support at 510-926-6913 (TEXT ONLY)</p>
      </div>

      <player-list 
        :players="players"
        :capacity="capacity"
        @register-player="handleRegisterPlayer"
        @unregister-player="handleUnregisterPlayer"
      />

      <a href="roster.html" class="roster-link">
        <i class="fas fa-users"></i> VIEW ROSTER
      </a>

      <registration-dialog 
        :show="showRegistrationDialog"
        :player="currentRegistrationData?.player"
        @close="showRegistrationDialog = false"
        @confirm="confirmRegistration"
      />

      <unregistration-dialog 
        :show="showUnregistrationDialog"
        :player="currentUnregistrationData?.player"
        @close="showUnregistrationDialog = false"
        @confirm="confirmUnregistration"
      />
    </div>
  `
};

// ========================================
// CREATE VUE APP
// ========================================
createApp({
  components: {
    RegistrationApp
  }
}).mount('#vue-registration-app');
