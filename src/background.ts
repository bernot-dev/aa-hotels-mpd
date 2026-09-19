// Background Service Worker for AA Hotels MPD

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url || !tab.url.includes('aadvantagehotels.com')) {
    return;
  }

  // Detect SPA URL changes or completed page loads
  if (changeInfo.url || changeInfo.status === 'complete') {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'SPA_NAVIGATED',
        url: tab.url,
        status: changeInfo.status,
      });
    } catch {
      // Content script may not be loaded yet or tab is closing - safe to ignore
    }
  }
});
