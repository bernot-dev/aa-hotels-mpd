// options.js

// Saves options to chrome.storage
async function save_options() {
  const expandRoomRates = document.getElementById('expandRoomRates').checked;
  const expandRoomTypes = document.getElementById('expandRoomTypes').checked;
  const includeBonusMiles = document.getElementById('includeBonusMiles').checked;
  const showDebugButton = document.getElementById('showDebugButton').checked;

  try {
    await chrome.storage.sync.set({
      expandRoomRates,
      expandRoomTypes,
      includeBonusMiles,
      showDebugButton,
    });

    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    setTimeout(() => {
      status.textContent = '';
    }, 1500);
  } catch (err) {
    const status = document.getElementById('status');
    status.style.color = 'red';
    status.textContent = 'Failed to save options.';
  }
}

// Restores checkbox state using the preferences stored in chrome.storage.
async function restore_options() {
  try {
    const config = await chrome.storage.sync.get({
      expandRoomRates: false,
      expandRoomTypes: false,
      includeBonusMiles: false,
      showDebugButton: true,
    });

    document.getElementById('expandRoomRates').checked = config.expandRoomRates;
    document.getElementById('expandRoomTypes').checked = config.expandRoomTypes;
    document.getElementById('includeBonusMiles').checked = config.includeBonusMiles;
    document.getElementById('showDebugButton').checked = config.showDebugButton;
  } catch (err) {
    console.error('Failed to restore options:', err);
  }
}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);
