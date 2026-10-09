import { updateCards, CARD_SELECTOR, BOOST_STYLE_ID } from "./cards";
import { getNights } from "./nights";
import { loadPricingSettings } from "./settings";
import { updateMapPins } from "./map";
import { resetRateCollector, queueRatesForDispatch } from "./capture/collector";
import { extractRatesFromSearchCards } from "./capture/rates";
import { extractSearchCriteria } from "./capture/criteria";
import { setupMpdSort } from "./sort";

export interface SearchExpansionOptions {
  expandSearchResults: boolean;
  maxClicks?: number;
  maxConsecutiveNoChange?: number;
  pollIntervalMs?: number;
  postClickDelayMs?: number;
  waitTimeoutMs?: number;
  maxInitialWaitMs?: number;
}

export function setupSearchExpansion(options: SearchExpansionOptions) {
  const {
    expandSearchResults,
    maxClicks = 100,
    maxConsecutiveNoChange = 5,
    pollIntervalMs = 200,
    postClickDelayMs = 100,
    waitTimeoutMs = 8000,
    maxInitialWaitMs = 5000,
  } = options;

  let isDisposed = false;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let initialPollInterval: ReturnType<typeof setInterval> | null = null;
  let waitTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let isWaitingForNewCards = false;
  let totalClicks = 0;
  let consecutiveNoChange = 0;
  let lastCardCount = 0;
  let initialPollElapsedMs = 0;
  const INITIAL_POLL_STEP_MS = 250;

  const clearScheduledTimer = () => {
    if (scheduledTimer !== null) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
  };

  const clearInitialPoll = () => {
    if (initialPollInterval !== null) {
      clearInterval(initialPollInterval);
      initialPollInterval = null;
    }
  };

  const clearWaitTimeout = () => {
    if (waitTimeoutTimer !== null) {
      clearTimeout(waitTimeoutTimer);
      waitTimeoutTimer = null;
    }
  };

  // Only true "load more" buttons append results. Pagination ("Next", page numbers) replaces the
  // current page, and carousel arrows ("Next property image") are not result controls, so neither
  // may ever be clicked.
  const LOAD_MORE_TEXT = /^(?:load|show|see|view) more(?: hotels| results| properties)?$/;
  const findLoadMoreButton = (): HTMLButtonElement | null => {
    const candidates = document.querySelectorAll<HTMLButtonElement>(
      'button, [role="button"], [data-selenium="load-more-button"], [data-element-name="load-more-button"]'
    );
    for (let i = 0; i < candidates.length; i++) {
      const btn = candidates[i];
      if (
        btn.closest(
          '[data-selenium="pagination-panel"], #paginationContainer, [data-element-name*="pagination" i], [data-element-name*="carousel" i], [data-element-name="property-card-gallery"]'
        )
      ) {
        continue;
      }
      const attr = `${btn.getAttribute("data-selenium") || ""} ${btn.getAttribute("data-element-name") || ""}`;
      const text = btn.textContent?.trim().toLowerCase().replace(/\s+/g, " ") || "";
      if (/load-more/i.test(attr) || LOAD_MORE_TEXT.test(text)) {
        return btn;
      }
    }
    return null;
  };

  const countCards = (): number => {
    return document.querySelectorAll(CARD_SELECTOR).length;
  };

  const isButtonBusy = (btn: HTMLElement): boolean => {
    if ((btn as HTMLButtonElement).disabled) return true;
    if (btn.getAttribute("aria-disabled") === "true") return true;
    if (btn.getAttribute("aria-busy") === "true") return true;
    if (btn.hasAttribute("data-loading")) return true;
    if (
      btn.querySelector(
        '.chakra-spinner, .chakra-button__spinner, [data-loading], svg[class*="spin"], [class*="spinner" i]'
      )
    ) {
      return true;
    }
    const text = btn.textContent?.trim().toLowerCase() || "";
    if (text.includes("loading") || text.includes("searching")) {
      return true;
    }
    return false;
  };

  const checkAndExpand = () => {
    if (!expandSearchResults || isDisposed) return;
    if (totalClicks >= maxClicks) return;

    const moreButton = findLoadMoreButton();
    if (!moreButton) {
      if (totalClicks > 0) {
        clearInitialPoll();
      }
      return;
    }

    clearInitialPoll();

    const currentCount = countCards();

    if (isWaitingForNewCards) {
      if (currentCount > lastCardCount) {
        isWaitingForNewCards = false;
        consecutiveNoChange = 0;
        clearWaitTimeout();
      } else {
        // Still waiting for network response or DOM hydration; keep polling
        scheduleCheck(pollIntervalMs);
        return;
      }
    }

    if (isButtonBusy(moreButton)) {
      scheduleCheck(pollIntervalMs);
      return;
    }

    lastCardCount = currentCount;
    totalClicks++;
    isWaitingForNewCards = true;

    clearWaitTimeout();
    waitTimeoutTimer = setTimeout(() => {
      if (isWaitingForNewCards && !isDisposed) {
        consecutiveNoChange++;
        isWaitingForNewCards = false;
        if (consecutiveNoChange < maxConsecutiveNoChange) {
          scheduleCheck(pollIntervalMs);
        } else {
          console.warn(
            "[AA-Hotels-MPD] Stopped search expansion: no new hotels appeared after multiple attempts."
          );
        }
      }
    }, waitTimeoutMs);

    try {
      moreButton.click();
    } catch (err) {
      console.warn("[AA-Hotels-MPD] Error clicking Load more button:", err);
      isWaitingForNewCards = false;
      clearWaitTimeout();
    }

    scheduleCheck(postClickDelayMs);
  };

  const scheduleCheck = (delayMs: number) => {
    if (isDisposed) return;
    clearScheduledTimer();
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      checkAndExpand();
    }, delayMs);
  };

  if (expandSearchResults) {
    scheduleCheck(100);
    initialPollInterval = setInterval(() => {
      initialPollElapsedMs += INITIAL_POLL_STEP_MS;
      if (initialPollElapsedMs >= maxInitialWaitMs || isDisposed) {
        clearInitialPoll();
      }
      checkAndExpand();
    }, INITIAL_POLL_STEP_MS);
  }

  const onMutation = () => {
    if (isDisposed) return;
    if (expandSearchResults) {
      scheduleCheck(50);
    }
  };

  const teardown = () => {
    isDisposed = true;
    clearScheduledTimer();
    clearInitialPoll();
    clearWaitTimeout();
  };

  return { onMutation, teardown };
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
    observer.disconnect();
    document
      .querySelectorAll('#aa-mpd-search-summary, [id^="aa-mpd-search-summary"]')
      .forEach((el) => el.remove());
    document.getElementById(BOOST_STYLE_ID)?.remove();
    resetRateCollector();
  };
};
