import { updateCards } from "./cards";
import { getNights } from "./nights";
import { processMapPreviewCards, updateMapPins } from "./map";
import { extractSearchCriteria } from "./capture/criteria";
import { extractRatesFromSearchCards } from "./capture/rates";
import { queueRatesForDispatch, resetRateCollector } from "./capture/collector";

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

  const findLoadMoreButton = (): HTMLButtonElement | null => {
    // 1. Check aria-label="Load more" or data-testid
    const byAttr = document.querySelector<HTMLButtonElement>(
      'button[aria-label*="load more" i], [data-testid*="load-more" i], [data-testid="load-more-button"]'
    );
    if (byAttr) return byAttr;

    // 2. Check by text content across all button and role=button elements
    const allButtons = document.querySelectorAll<HTMLButtonElement>(
      'button, [role="button"]'
    );
    for (let i = 0; i < allButtons.length; i++) {
      const btn = allButtons[i];
      const text = btn.textContent?.trim().toLowerCase() || "";
      if (
        text === "load more" ||
        text === "show more" ||
        text === "see more" ||
        text === "load more hotels" ||
        text === "show more hotels" ||
        text === "view more hotels" ||
        text.startsWith("load more") ||
        text.startsWith("show more")
      ) {
        return btn;
      }
    }
    return null;
  };

  const countCards = (): number => {
    return document.querySelectorAll(
      '[data-testid="hotel-card-pricing"], [data-testid^="hotel-card-"], section[data-testid^="hotel-card-"]'
    ).length;
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
  maxMPDElem.style.background = "#fff3cd";
  maxMPDElem.style.color = "#856404";
  maxMPDElem.style.border = "1px solid #ffeeba";
  maxMPDElem.style.borderRadius = "8px";
  maxMPDElem.style.padding = "14px 20px";
  maxMPDElem.style.margin = "16px 0";
  maxMPDElem.style.fontSize = "16px";
  maxMPDElem.style.display = "none";

  let includeBonusMiles = false;
  let expandSearchResults = true;

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get([
        "includeBonusMiles",
        "expandSearchResults",
      ]);
      includeBonusMiles = Boolean(result.includeBonusMiles);
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

  container.insertAdjacentElement("beforebegin", maxMPDElem);

  const cardSelector = '[data-testid="hotel-card-pricing"]';
  const observeRoot = document.body;

  const onCardsProcessed = () => {
    try {
      const nights = getNights();
      const criteria = extractSearchCriteria();
      const rates = extractRatesFromSearchCards(document.body, nights, includeBonusMiles);
      if (rates.length > 0) {
        queueRatesForDispatch(criteria, rates);
      }
    } catch (err) {
      console.debug("[AA-Hotels-MPD] Error capturing search rates:", err);
    }
  };

  const callback = updateCards(
    observeRoot,
    maxMPDElem,
    cardSelector,
    includeBonusMiles,
    onCardsProcessed
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
      const activeContainer =
        document.querySelector('[data-testid="hotel-results-list-container"]') ||
        document.querySelector('[data-testid="search-results-map"]');
      if (activeContainer) {
        activeContainer.insertAdjacentElement("beforebegin", maxMPDElem);
      }
    }

    // 1. Process search list cards
    callback();
    searchExpansion.onMutation();

    // 2. Process map preview cards and pins anywhere in the page
    processMapPreviewCards(document.body, nights, includeBonusMiles);
    updateMapPins(document.body);
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
        target?.dataset?.aaMpd
      ) {
        return false;
      }
      return true;
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
    observer.disconnect();
    document
      .querySelectorAll('#aa-mpd-search-summary, [id^="aa-mpd-search-summary"]')
      .forEach((el) => el.remove());
    resetRateCollector();
  };
};
