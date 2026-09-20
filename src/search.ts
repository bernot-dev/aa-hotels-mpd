import { updateCards } from "./cards";
import { extractSearchCriteria } from "./capture/criteria";
import { extractRatesFromSearchCards } from "./capture/rates";
import { queueRatesForDispatch, resetRateCollector } from "./capture/collector";
import { getNights } from "./nights";

export const processSearchPage = async (container: Element): Promise<() => void> => {
  // Clean up any existing summary banner
  const existingSummary = document.getElementById("aa-mpd-search-summary");
  if (existingSummary) {
    existingSummary.remove();
  }

  const maxMPDElem = document.createElement("div");
  maxMPDElem.id = "aa-mpd-search-summary";
  maxMPDElem.style.background = "#fff3cd";
  maxMPDElem.style.color = "#856404";
  maxMPDElem.style.border = "1px solid #ffeeba";
  maxMPDElem.style.borderRadius = "8px";
  maxMPDElem.style.padding = "14px 20px";
  maxMPDElem.style.margin = "16px 0";
  maxMPDElem.style.fontSize = "16px";
  maxMPDElem.style.display = "none";

  let includeBonusMiles = false;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get(["includeBonusMiles"]);
      includeBonusMiles = Boolean(result.includeBonusMiles);
    }
  } catch (err) {
    console.warn("[AA-Hotels-MPD] Failed to read storage options:", err);
  }

  const cardSelector = '[data-testid="hotel-card-pricing"]';

  const onCardsProcessed = () => {
    try {
      const nights = getNights();
      const criteria = extractSearchCriteria();
      const rates = extractRatesFromSearchCards(container, nights, includeBonusMiles);
      if (rates.length > 0) {
        queueRatesForDispatch(criteria, rates);
      }
    } catch (err) {
      console.debug("[AA-Hotels-MPD] Error capturing search rates:", err);
    }
  };

  const callback = updateCards(
    container,
    maxMPDElem,
    cardSelector,
    includeBonusMiles,
    onCardsProcessed
  );

  const observer = new MutationObserver((mutations) => {
    callback(mutations);
  });

  // Observe container subtree for async additions (e.g. infinite scroll / filtering)
  observer.observe(container, { childList: true, subtree: true });

  container.insertAdjacentElement("beforebegin", maxMPDElem);

  // Process existing cards immediately without waiting for a mutation
  callback();

  // Return cleanup teardown function
  return () => {
    observer.disconnect();
    maxMPDElem.remove();
    resetRateCollector();
  };
};
