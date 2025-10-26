/**
 * Round Robin Registration JavaScript
 * Handles player lookup, registration, and unregistration functionality
 */

// Global variables
let players = [];
let currentRegistrationData = null;
let currentUnregistrationData = null;
let registrationOpen = false;

// Configuration
const scriptUrl = `${config.scriptUrl}`;

// Developer override for testing - check URL parameters and localStorage
const urlParams = new URLSearchParams(window.location.search);
// const devOverride = urlParams.get('dev') === 'true' || localStorage.getItem('devMode') === 'true';
const devOverride = true;

if (devOverride) {
  console.log('🔧 Developer mode enabled - time restrictions bypassed');
  // Show dev indicator
  document.addEventListener('DOMContentLoaded', function() {
    const devIndicator = document.createElement('div');
    devIndicator.innerHTML = '🔧 DEV MODE - Time restrictions disabled';
    devIndicator.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff6b6b;color:white;text-align:center;padding:5px;font-weight:bold;z-index:9999;';
    document.body.prepend(devIndicator);
  });
}

// ========================================
// REGISTRATION STATUS FUNCTIONS
// ========================================

function isRegistrationOpen() {
  // Developer override - always return true if dev mode is enabled
  if (devOverride) {
    return true;
  }

  const now = new Date();
  // Convert to PST/PDT timezone
  const pstNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
  const dayOfWeek = pstNow.getDay(); // 0 = Sunday, 5 = Friday
  const hours = pstNow.getHours();
  const minutes = pstNow.getMinutes();

  // Only open on Fridays (5) between 00:00 and 18:45
  if (dayOfWeek === 5) {
    if (hours < 18 || (hours === 18 && minutes <= 45)) {
      return true;
    }
  }

  return false;
}

function getNextFridayOpening() {
  const now = new Date();
  const pstNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
  const dayOfWeek = pstNow.getDay();

  // Calculate days until next Friday
  let daysUntilFriday;
  if (dayOfWeek === 5) {
    // If it's Friday but registration is closed, next Friday is in 7 days
    daysUntilFriday = 7;
  } else {
    // Days until next Friday
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
}

function getTodayClosingTime() {
  const now = new Date();
  const pstNow = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
  const closingTime = new Date(pstNow);
  closingTime.setHours(18, 45, 0, 0);

  return closingTime.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: 'numeric',
    minute: '2-digit'
  });
}

function checkRegistrationStatus() {
  const statusBanner = document.getElementById('statusBanner');
  const statusMessage = document.getElementById('statusMessage');
  const registrationContent = document.getElementById('registrationContent');

  registrationOpen = isRegistrationOpen();

  if (registrationOpen) {
    const closingTime = getTodayClosingTime();
    const devModeText = devOverride ? ' (DEV MODE)' : '';
    statusMessage.innerHTML = `
      <div>🟢 Registration is OPEN${devModeText}</div>
      <div class="status-details">${devOverride ? 'Developer override active' : `Closes today at ${closingTime} PST`}</div>
    `;
    statusBanner.className = 'status-banner status-open';
    registrationContent.classList.remove('registration-disabled');
  } else {
    const nextOpening = getNextFridayOpening();
    statusMessage.innerHTML = `
      <div>🔴 Registration is CLOSED</div>
      <div class="status-details">Next opening: ${nextOpening} PST</div>
    `;
    statusBanner.className = 'status-banner status-closed';
    registrationContent.classList.add('registration-disabled');
  }
}

// ========================================
// CAPACITY CHECKING SYSTEM
// ========================================

function checkRegistrationCapacity(eventId) {
  var url = eventId
    ? scriptUrl + '/rr/capacity?event_id=' + encodeURIComponent(eventId)
    : scriptUrl + '/rr/capacity';

  return fetch(url, { method: 'POST' })
    .then(function (res) {
      if (!res.ok) {
        return res.clone().text().then(function (t) {
          throw new Error('Capacity check failed: ' + res.status + ' ' + res.statusText + ' ' + t);
        });
      }
      return res.json();
    })
    .then(function (data) {
      return {
        isAtCapacity: !!data.roster_full,
        confirmedCount: Number(data.confirmed_count || 0),
        playerCap: Number(data.player_cap || 65),
        spotsAvailable: Number(data.spots_available || 0),
        eventOpen: !!data.event_open
      };
    })
    .catch(function (err) {
      console.error('Error checking capacity:', err);
      return { isAtCapacity: false, confirmedCount: 0, playerCap: 65, spotsAvailable: 0, eventOpen: false };
    });
}

// ========================================
// DISPLAY FUNCTION (with capacity checking)
// ========================================

function displayPlayerData(data, resultDiv, formDiv) {
  resultDiv.innerHTML = '';
  formDiv.innerHTML = '';

  if (data.result === "None" || data.length === 0) {
    resultDiv.innerHTML = `<p class="error">No player found for this phone number.<br/><br/>
    <a href="player_signup.html" style="font-size: 1.2em; font-weight: bold; color: #0d6efd; text-decoration: underline; display: inline-block; padding: 0.5rem; background-color: #f8f9fa; border-radius: 6px; margin: 0.5rem 0;"> PLAYER INFO SIGNUP</a><br/><br/>
    Otherwise Contact BTTC support at 510-926-6913 (TEXT ONLY)</p>`;
    return;
  }

  players = data;

  // Check capacity before showing registration options
  checkRegistrationCapacity().then(capacityInfo => {
    let html = `<p class="success">Manage your registration:</p>`;

    // Show capacity status
    if (capacityInfo.isAtCapacity) {
      html += `<div class="capacity-banner capacity-full">
        <div>🔴 Registration is FULL</div>
        <div class="status-details">${capacityInfo.confirmedCount}/${capacityInfo.playerCap} spots filled</div>
      </div>`;
    } else {
      html += `<div class="capacity-banner capacity-available">
        <div>🟢 ${capacityInfo.spotsAvailable} spots available</div>
        <div class="status-details">${capacityInfo.confirmedCount}/${capacityInfo.playerCap} spots filled</div>
      </div>`;
    }

    data.forEach((p, i) => {
      const fullName = `${p.first_name} ${p.last_name}`;
      const bttcID = `${p.bttc_id}`;
      const isRegistered = p.is_registered;
      html += `<div class="entry">`;

      if (isRegistered) {
        html += `
          <p style="color: gray;">
            ${fullName} <span style="font-weight: bold;">(Already registered)</span>
          </p>
          <div class="unregister-form">
            <input type="text" placeholder="Enter your PIN" class="token-field" />
            <button style="background-color: #dc3545;" class="confirm-btn" onclick="unregisterPlayer(${i})">Unregister</button>
            <span class="token-error"></span>
          </div>`;
      } else {
        // Only show registration option if not at capacity
        if (capacityInfo.isAtCapacity) {
          html += `
            <p style="color: #666;">
              ${fullName}
            </p>
            <div class="register-form">
              <p class="registration-full-message">
                ❌ Registration is full (${capacityInfo.confirmedCount}/${capacityInfo.playerCap})
              </p>
            </div>`;
        } else {
          html += `
            <p>
              ${fullName}
            </p>
            <div class="register-form">
              <input type="text" placeholder="Enter your PIN" class="token-field" />
              <button class="confirm-btn" onclick="registerPlayer(${i})">Register</button>
              <span class="token-error"></span>
            </div>`;
        }
      }
      html += `</div>`;
    });

    formDiv.innerHTML = html;
  });
}

// ========================================
// ENHANCED PHONE LOOKUP WITH CACHING
// ========================================

function setupPhoneLookup() {
  document.getElementById('lookupForm').addEventListener('submit', function (e) {
    e.preventDefault();

    // Check if registration is open before proceeding
    if (!registrationOpen) {
      alert('Registration is currently closed. Please check the status banner above for when it will reopen.');
      return;
    }

    const phone = document.getElementById('phoneInput').value.trim().replace(/^1|\D/g, '');
    const resultDiv = document.getElementById('result');
    const formDiv = document.getElementById('registrationForm');

    if (!phone) {
      resultDiv.innerHTML = `<p class="error">Please enter a phone number.</p>`;
      return;
    }
    resultDiv.innerHTML = 'Looking up player data...';
    formDiv.innerHTML = '';
    players = [];

    fetch(`${scriptUrl}/rr/search?phone=${encodeURIComponent(phone)}`)
      .then(res => res.text())
      .then(text => {
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          resultDiv.innerHTML = `<p class="error">Invalid response from server.</p>`;
          return;
        }

        // Display the data
        displayPlayerData(data, resultDiv, formDiv);
      })
      .catch(err => {
        resultDiv.innerHTML = `<p class="error">An error occurred: ${err.message}</p>`;
      });
  });
}

// ========================================
// REGISTRATION FUNCTIONS
// ========================================

function registerPlayer(index) {
  // Double-check registration is open
  if (!registrationOpen) {
    alert('Registration is currently closed.');
    return;
  }

  // Check capacity before proceeding
  checkRegistrationCapacity().then(capacityInfo => {
    if (capacityInfo.isAtCapacity) {
      alert(`Registration is full! All ${capacityInfo.playerCap} spots have been taken.`);
      // Refresh the display to show updated status
      const phone = document.getElementById('phoneInput').value.trim().replace(/^1|\D/g, '');
      if (phone) {
        document.getElementById('lookupForm').dispatchEvent(new Event('submit'));
      }
      return;
    }

    // Proceed with normal registration flow
    const player = players[index];
    const entry = document.getElementById("registrationForm").querySelectorAll(".entry")[index];
    const tokenField = entry.querySelector(".register-form .token-field");
    const errorEl = entry.querySelector(".register-form .token-error");
    const token = tokenField.value.trim();

    if (!token) {
      errorEl.textContent = "Please enter your PIN.";
      errorEl.style.display = "block";
      return;
    }

    // Store registration data and show dialog
    currentRegistrationData = {
      player: player,
      token: token,
      errorElement: errorEl
    };

    // Clear previous selections
    document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => radio.checked = false);
    document.getElementById('registrationComments').value = '';

    // Show dialog
    document.getElementById('registrationDialog').style.display = 'flex';
  });
}

function closeRegistrationDialog() {
  document.getElementById('registrationDialog').style.display = 'none';
  currentRegistrationData = null;
}

function confirmRegistration() {
  if (!currentRegistrationData) return;

  // Get selected payment method
  const selectedPayment = document.querySelector('input[name="paymentMethod"]:checked');
  if (!selectedPayment) {
    alert('Please select a payment method.');
    return;
  }

  // Get comments
  const comments = document.getElementById('registrationComments').value.trim();

  const payload = {
    bttc_id: currentRegistrationData.player.bttc_id,
    first_name: currentRegistrationData.player.first_name,
    last_name: currentRegistrationData.player.last_name,
    token: currentRegistrationData.token,
    payment_method: selectedPayment.value,
    comments: comments
  };

  fetch(`${scriptUrl}/rr/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
    .then(r => r.text())
    .then(text => {
      try {
        const data = JSON.parse(text);
        if (data.success) {
          alert(data.message);
          closeRegistrationDialog();

          // Clear the form
          document.getElementById('result').innerHTML = '';
          document.getElementById('registrationForm').innerHTML = '';
        } else {
          // Handle capacity full scenario
          if (data.isAtCapacity) {
            alert(`Registration is full! All ${data.playerCap} spots have been taken.`);
            closeRegistrationDialog();

            // Refresh display to show current status
            const phone = document.getElementById('phoneInput').value.trim().replace(/^1|\D/g, '');
            if (phone) {
              document.getElementById('lookupForm').dispatchEvent(new Event('submit'));
            }
          } else {
            currentRegistrationData.errorElement.textContent = data.message;
            currentRegistrationData.errorElement.style.display = "block";
            closeRegistrationDialog();
          }
        }
      } catch {
        currentRegistrationData.errorElement.textContent = "Unexpected server response.";
        currentRegistrationData.errorElement.style.display = "block";
        closeRegistrationDialog();
      }
    })
    .catch(err => {
      currentRegistrationData.errorElement.textContent = "Failed to register: " + err.message;
      currentRegistrationData.errorElement.style.display = "block";
      closeRegistrationDialog();
    });
}

// ========================================
// UNREGISTRATION FUNCTIONS
// ========================================

function unregisterPlayer(index) {
  const player = players[index];
  const entry = document.getElementById("registrationForm").querySelectorAll(".entry")[index];
  const tokenField = entry.querySelector(".unregister-form .token-field");
  const errorEl = entry.querySelector(".unregister-form .token-error");
  const token = tokenField.value.trim();

  if (!token) {
    errorEl.textContent = "Please enter your PIN.";
    errorEl.style.display = "block";
    return;
  }

  // Store unregistration data and show dialog
  currentUnregistrationData = {
    player: player,
    token: token,
    errorElement: errorEl
  };

  // Clear previous comments
  document.getElementById('unregistrationComments').value = '';

  // Show unregistration dialog
  document.getElementById('unregistrationDialog').style.display = 'flex';
}

function closeUnregistrationDialog() {
  document.getElementById('unregistrationDialog').style.display = 'none';
  currentUnregistrationData = null;
}

function confirmUnregistration() {
  if (!currentUnregistrationData) return;

  // Get comments
  const comments = document.getElementById('unregistrationComments').value.trim();

  const payload = {
    bttc_id: currentUnregistrationData.player.bttc_id,
    first_name: currentUnregistrationData.player.first_name,
    last_name: currentUnregistrationData.player.last_name,
    token: currentUnregistrationData.token,
    comments: comments
  };

  fetch(`${scriptUrl}/rr/unregister`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
    .then(r => r.text())
    .then(text => {
      try {
        const data = JSON.parse(text);
        if (data.success) {
          alert(data.message);
          closeUnregistrationDialog();

          // 🔄 REFRESH THE DISPLAY to show updated capacity
          const phone = document.getElementById('phoneInput').value.trim().replace(/^1|\D/g, '');
          if (phone) {
            // Auto-refresh to show the newly available spot
            document.getElementById('lookupForm').dispatchEvent(new Event('submit'));
          }
        } else {
          currentUnregistrationData.errorElement.textContent = data.message;
          currentUnregistrationData.errorElement.style.display = "block";
          closeUnregistrationDialog();
        }
      } catch {
        currentUnregistrationData.errorElement.textContent = "Unexpected server response.";
        currentUnregistrationData.errorElement.style.display = "block";
        closeUnregistrationDialog();
      }
    })
    .catch(err => {
      currentUnregistrationData.errorElement.textContent = "Failed to unregister: " + err.message;
      currentUnregistrationData.errorElement.style.display = "block";
      closeUnregistrationDialog();
    });
}

// ========================================
// DIALOG EVENT HANDLERS
// ========================================

function setupDialogEventHandlers() {
  // Close dialog when clicking outside of it
  document.getElementById('registrationDialog').addEventListener('click', function(e) {
    if (e.target === this) {
      closeRegistrationDialog();
    }
  });

  // Close unregistration dialog when clicking outside of it
  document.getElementById('unregistrationDialog').addEventListener('click', function(e) {
    if (e.target === this) {
      closeUnregistrationDialog();
    }
  });
}

// ========================================
// INITIALIZATION
// ========================================

// Check registration status on page load
document.addEventListener('DOMContentLoaded', function() {
  checkRegistrationStatus();
  setupPhoneLookup();
  setupDialogEventHandlers();
});
