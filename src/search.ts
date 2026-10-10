import { updateCards, CARD_SELECTOR, BOOST_STYLE_ID } from "./cards";
import { getNights } from "./nights";
import { loadPricingSettings } from "./settings";
import { updateMapPins } from "./map";
import { resetRateCollector, queueRatesForDispatch } from "./capture/collector";
import { extractRatesFromSearchCards } from "./capture/rates";
import { extractSearchCriteria } from "./capture/criteria";
import { setupMpdSort } from "./sort";
import { abortBackgroundSearchQueries } from "./search-query";
import { EXPAND_LIST_MESSAGE } from "./list-expander";

export interface SearchExpansionOptions {
  expandSearchResults: boolean;
}

/**
 * Loads every card on the results page. The list's loading triggers are only reachable from the
 * MAIN world, where they fire without scrolling (see list-expander.ts), so this just asks it to
 * expand whenever the list changes.
 */
export function setupSearchExpansion(options: SearchExpansionOptions) {
  const { expandSearchResults } = options;
  let isDisposed = false;

  const requestExpansion = () => {
    if (!expandSearchResults || isDisposed) return;
    window.postMessage({ type: EXPAND_LIST_MESSAGE }, "*");
  };

  requestExpansion();

  const teardown = () => {
    isDisposed = true;
  };

  return { onMutation: requestExpansion, teardown };
}

export interface ProcessSearchPageOptions {
  signal?: AbortSignal;
}

export const processSearchPage = async (
  container: Element,
  options: ProcessSearchPageOptions = {}
): Promise<() => void> => {
  if (options.signal?.aborted) {
    return () => {};
  }

  // Clean up ALL existing summary banners to prevent duplicate banners
  document
    .querySelectorAll('#aa-mpd-search-summary, [id^="aa-mpd-search-summary"]')
    .forEach((el) => el.remove());

  const maxMPDElem = document.createElement("div");
  maxMPDElem.id = "aa-mpd-search-summary";
  maxMPDElem.className = "aa-mpd-banner";
  maxMPDElem.dataset.aaMpd = "true";
  maxMPDElem.style.background = "linear-gradient(135deg, #f0f7ff 0%, #e1effe 100%)";
  maxMPDElem.style.color = "#0d2440";
  maxMPDElem.style.border = "1px solid #bfdbfe";
  maxMPDElem.style.borderLeft = "5px solid #0078d2";
  maxMPDElem.style.borderRadius = "10px";
  maxMPDElem.style.padding = "12px 18px";
  maxMPDElem.style.margin = "16px 0";
  maxMPDElem.style.fontSize = "15px";
  maxMPDElem.style.display = "none";

  const { includeBonusMiles, useAllInPricing, earningLevel } = await loadPricingSettings();
  let expandSearchResults = true;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get(["expandSearchResults"]);
      if (typeof result.expandSearchResults === "boolean") {
        expandSearchResults = result.expandSearchResults;
      }
    }
  } catch (err) {
    console.warn("[AA-Hotels-MPD] Failed to read storage options:", err);
  }

  if (options.signal?.aborted) {
    return () => {};
  }

  // Ensure no other banner was inserted while awaiting storage
  document
    .querySelectorAll('#aa-mpd-search-summary, [id^="aa-mpd-search-summary"]')
    .forEach((el) => el.remove());

  const hotelList =
    document.querySelector("ol.hotel-list-container") ||
    container.querySelector("ol.hotel-list-container");
  if (hotelList) {
    hotelList.insertAdjacentElement("beforebegin", maxMPDElem);
  } else {
    container.insertAdjacentElement("beforebegin", maxMPDElem);
  }

  const cardSelector = CARD_SELECTOR;
  const observeRoot = document.body;

  const mpdSort = setupMpdSort();

  // Reorder after badges update so the MPD sort follows the rates users see
  const callback = updateCards(
    observeRoot,
    maxMPDElem,
    cardSelector,
    includeBonusMiles,
    useAllInPricing,
    { earningLevel, onProcessed: () => mpdSort.apply() }
  );

  const searchExpansion = setupSearchExpansion({
    expandSearchResults,
  });

  const nights = getNights();

  let isScheduled = false;
  const runDomUpdate = () => {
    isScheduled = false;

    // Ensure summary banner remains attached if view toggled
    const currentBanner = document.getElementById("aa-mpd-search-summary");
    if (!currentBanner || !currentBanner.parentElement) {
      const hotelList =
        document.querySelector("ol.hotel-list-container") ||
        container.querySelector("ol.hotel-list-container");
      if (hotelList) {
        hotelList.insertAdjacentElement("beforebegin", maxMPDElem);
      } else {
        const activeContainer =
          document.querySelector('#searchPageRightColumn') ||
          document.querySelector('#contentContainer') ||
          document.querySelector('[data-selenium="pagination-panel"]') ||
          document.querySelector('#searchPageReactRoot') ||
          container;
        if (activeContainer) {
          activeContainer.insertAdjacentElement("beforebegin", maxMPDElem);
        }
      }
    }

    // 1. Process search list cards
    callback();
    searchExpansion.onMutation();

    // 2. Recolor map pins anywhere in the page (map preview cards are the same
    // property cards, so updateCards already badges them with the user's pricing settings)
    updateMapPins(document.body, useAllInPricing);

    // 3. Capture newly resolved rates into database
    try {
      const criteria = extractSearchCriteria();
      const domRates = extractRatesFromSearchCards(document.body, nights, includeBonusMiles, earningLevel);
      if (domRates.length > 0) {
        queueRatesForDispatch(criteria, domRates);
      }
    } catch {}
  };

  const scheduleDomUpdate = () => {
    if (isScheduled) return;
    isScheduled = true;
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(runDomUpdate);
    } else {
      setTimeout(runDomUpdate, 16);
    }
  };

  // Watch for mutations across commonRoot (covers both list and map view elements)
  const observer = new MutationObserver((mutations) => {
    const hasExternal = mutations.some((m) => {
      const target = m.target as HTMLElement;
      if (
        target?.classList?.contains("aa-mpd-badge") ||
        target?.id === "aa-mpd-search-summary" ||
        target?.dataset?.aaMpd ||
        target?.closest?.(".aa-mpd-badge, #aa-mpd-search-summary, [data-aa-mpd]")
      ) {
        return false;
      }
      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i] as HTMLElement;
        if (
          node.classList?.contains?.("aa-mpd-badge") ||
          node.dataset?.aaMpd === "true" ||
          node.closest?.(".aa-mpd-badge, #aa-mpd-search-summary, [data-aa-mpd]")
        ) {
          continue;
        }
        return true;
      }
      return m.addedNodes.length === 0;
    });

    if (hasExternal) {
      scheduleDomUpdate();
    }
  });

  observer.observe(observeRoot, { childList: true, subtree: true });

  // Handle map toggle clicks explicitly
  const handleMapToggleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-testid="map-toggle-button"]')) {
      setTimeout(runDomUpdate, 50);
      setTimeout(runDomUpdate, 200);
      setTimeout(runDomUpdate, 600);
      setTimeout(runDomUpdate, 1200);
    }
  };
  document.body.addEventListener("click", handleMapToggleClick);

  // Initial immediate processing
  runDomUpdate();

  // Return cleanup teardown function
  return () => {
    document.body.removeEventListener("click", handleMapToggleClick);
    searchExpansion.teardown();
    mpdSort.teardown();
    abortBackgroundSearchQueries();
    observer.disconnect();
    document
      .querySelectorAll('#aa-mpd-search-summary, [id^="aa-mpd-search-summary"]')
      .forEach((el) => el.remove());
    document.getElementById(BOOST_STYLE_ID)?.remove();
    resetRateCollector();
  };
};
