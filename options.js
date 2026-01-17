// options.js

// Saves options to chrome.storage
function save_options() {
  const expandRoomRates = document.getElementById('expandRoomRates').checked;
  const expandRoomTypes = document.getElementById('expandRoomTypes').checked;
  const includeBonusMiles = document.getElementById('includeBonusMiles').checked;
  chrome.storage.sync.set({
    expandRoomRates: expandRoomRates,
    expandRoomTypes: expandRoomTypes,
    includeBonusMiles: includeBonusMiles,
  }, () => {
    // Update status to let user know options were saved.
    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    setTimeout(() => {
      status.textContent = '';
    }, 750);
  });
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restore_options() {
  chrome.storage.sync.get({
    expandRoomRates: false,
    expandRoomTypes: false,
  }, (config) => {
    document.getElementById('expandRoomRates').checked = config.expandRoomRates;
    document.getElementById('expandRoomTypes').checked = config.expandRoomTypes;
    document.getElementById('includeBonusMiles').checked = config.includeBonusMiles;
  });
}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);

