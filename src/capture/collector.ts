import { SearchCriteria, CapturedRate } from "../types";

// In-memory set to prevent dispatching identical rate observations repeatedly
const dispatchedRateKeys = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRates: CapturedRate[] = [];
let latestCriteria: SearchCriteria | null = null;

export function resetRateCollector(): void {
  dispatchedRateKeys.clear();
  pendingRates = [];
  latestCriteria = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function flushRates(): void {
  if (!latestCriteria || pendingRates.length === 0) {
    return;
  }

  const ratesToSend = [...pendingRates];
  const criteriaToSend = { ...latestCriteria };
  pendingRates = [];

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime
      .sendMessage({
        type: "RECORD_RATES",
        criteria: criteriaToSend,
        rates: ratesToSend,
      })
      .catch((err) => {
        // Service worker may be sleeping or closing - safe to log as debug
        console.debug("[AA-Hotels-MPD] Message dispatch deferred:", err);
      });
  }
}

export function queueRatesForDispatch(
  criteria: SearchCriteria,
  rates: CapturedRate[]
): void {
  latestCriteria = criteria;

  for (const rate of rates) {
    const key = `${criteria.location}|${rate.hotelName}|${criteria.checkIn}|${criteria.checkOut}|${rate.price}|${rate.miles}|${rate.mpd}`;
    if (!dispatchedRateKeys.has(key)) {
      dispatchedRateKeys.add(key);
      pendingRates.push(rate);
    }
  }

  if (pendingRates.length > 0) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    // Debounce 250ms to allow cards on the page to finish rendering
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flushRates();
    }, 250);
  }
}
