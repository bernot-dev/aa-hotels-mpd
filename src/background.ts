// Background Service Worker for AA Hotels MPD
import { recordRates } from "./db/db";
import { SearchCriteria, CapturedRate } from "./types";

// Open options.html when the extension toolbar icon is clicked
chrome.action?.onClicked?.addListener(() => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  }
});

// SPA Navigation listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url || !tab.url.includes("aadvantagehotels.com")) {
    return;
  }

  // Detect SPA URL changes or completed page loads
  if (changeInfo.url || changeInfo.status === "complete") {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "SPA_NAVIGATED",
        url: tab.url,
        status: changeInfo.status,
      });
    } catch {
      // Content script may not be loaded yet or tab is closing - safe to ignore
    }
  }
});

async function handleRecordRates(criteria: SearchCriteria, rates: CapturedRate[]): Promise<void> {
  let keepExhaustive = false;
  try {
    if (chrome.storage?.sync) {
      const res = await chrome.storage.sync.get(["keepExhaustiveQueryHistory"]);
      keepExhaustive = Boolean(res.keepExhaustiveQueryHistory);
    }
  } catch (err) {
    console.warn("[AA-Hotels-MPD] Failed to read keepExhaustiveQueryHistory config:", err);
  }

  await recordRates(criteria, rates, keepExhaustive);
}

// Runtime message listener for rate observations
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RECORD_RATES") {
    const criteria = message.criteria as SearchCriteria;
    const rates = message.rates as CapturedRate[];

    if (criteria && Array.isArray(rates) && rates.length > 0) {
      handleRecordRates(criteria, rates)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error("[AA-Hotels-MPD] Error in handleRecordRates:", err);
          sendResponse({ success: false, error: String(err) });
        });
      // Return true to indicate asynchronous response
      return true;
    }
  }
  return undefined;
});
