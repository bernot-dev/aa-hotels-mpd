import { updateCards } from "./cards";

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
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get(['includeBonusMiles']);
      includeBonusMiles = Boolean(result.includeBonusMiles);
    }
  } catch (err) {
    console.warn('[AA-Hotels-MPD] Failed to read storage options:', err);
  }

  const cardSelector = '[data-testid="hotel-card-pricing"]';
  const callback = updateCards(container, maxMPDElem, cardSelector, includeBonusMiles);

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
  };
};
