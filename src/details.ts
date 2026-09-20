import { updateCards } from "./cards";
import { extractSearchCriteria } from "./capture/criteria";
import { extractRatesFromDetailsCards } from "./capture/rates";
import { queueRatesForDispatch, resetRateCollector } from "./capture/collector";
import { getNights } from "./nights";

export const processDetailsPage = async (container: Element): Promise<() => void> => {
  const targetContainer = container.parentElement || container;

  // Clean up any existing summary banner
  const existingSummary = document.getElementById("aa-mpd-details-summary");
  if (existingSummary) {
    existingSummary.remove();
  }

  const maxMPDElem = document.createElement("div");
  maxMPDElem.id = "aa-mpd-details-summary";
  maxMPDElem.style.background = "#fff3cd";
  maxMPDElem.style.color = "#856404";
  maxMPDElem.style.border = "1px solid #ffeeba";
  maxMPDElem.style.borderRadius = "8px";
  maxMPDElem.style.padding = "14px 20px";
  maxMPDElem.style.margin = "16px 0";
  maxMPDElem.style.fontSize = "16px";
  maxMPDElem.style.display = "none";

  let expandRoomRates = false;
  let expandRoomTypes = false;
  let includeBonusMiles = false;

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get([
        "expandRoomRates",
        "expandRoomTypes",
        "includeBonusMiles",
      ]);
      expandRoomRates = Boolean(result.expandRoomRates);
      expandRoomTypes = Boolean(result.expandRoomTypes);
      includeBonusMiles = Boolean(result.includeBonusMiles);
    }
  } catch (err) {
    console.warn("[AA-Hotels-MPD] Failed to read storage options:", err);
  }

  const cardSelector = '[data-testid="room-card"]';

  const onCardsProcessed = () => {
    try {
      const nights = getNights();
      const criteria = extractSearchCriteria();
      const rates = extractRatesFromDetailsCards(targetContainer, nights, includeBonusMiles);
      if (rates.length > 0) {
        queueRatesForDispatch(criteria, rates);
      }
    } catch (err) {
      console.debug("[AA-Hotels-MPD] Error capturing details rates:", err);
    }
  };

  const callback = updateCards(
    targetContainer,
    maxMPDElem,
    cardSelector,
    includeBonusMiles,
    onCardsProcessed
  );

  const observer = new MutationObserver((mutations) => {
    callback(mutations);
  });

  observer.observe(targetContainer, { childList: true, subtree: true });

  targetContainer.insertAdjacentElement("beforebegin", maxMPDElem);

  // Safe, bounded expansion of room types (prevents infinite synchronous loops)
  if (expandRoomTypes) {
    let retries = 0;
    const expandNextGroup = () => {
      const moreButton = document.querySelector<HTMLButtonElement>(
        'button[data-testid="rooms-table-see-more-button"]'
      );
      if (moreButton && retries < 5) {
        retries++;
        moreButton.click();
        setTimeout(expandNextGroup, 300);
      }
    };
    setTimeout(expandNextGroup, 100);
  }

  // Safe expansion of room rates
  if (expandRoomRates) {
    setTimeout(() => {
      const toggles = document.querySelectorAll<HTMLButtonElement>(
        'button[data-testid="room-group-see-more-toggle"]'
      );
      toggles.forEach((button) => button.click());
    }, 400);
  }

  // Initial immediate processing
  callback();

  // Return cleanup teardown function
  return () => {
    observer.disconnect();
    maxMPDElem.remove();
    resetRateCollector();
  };
};
