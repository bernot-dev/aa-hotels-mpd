import { updateCards } from "./cards";
import { extractSearchCriteria } from "./capture/criteria";
import { extractRatesFromDetailsCards } from "./capture/rates";
import { queueRatesForDispatch, resetRateCollector } from "./capture/collector";
import { getNights } from "./nights";

export interface RoomExpansionOptions {
  expandRoomTypes: boolean;
  expandRoomRates: boolean;
  maxClicks?: number;
  maxConsecutiveNoChange?: number;
  pollIntervalMs?: number;
  postClickDelayMs?: number;
  waitTimeoutMs?: number;
  maxInitialWaitMs?: number;
}

export function setupRoomExpansion(options: RoomExpansionOptions): {
  onMutation: () => void;
  teardown: () => void;
} {
  const {
    expandRoomTypes,
    expandRoomRates,
    maxClicks = 50,
    maxConsecutiveNoChange = 5,
    pollIntervalMs = 200,
    postClickDelayMs = 200,
    waitTimeoutMs = 2000,
    maxInitialWaitMs = 3000,
  } = options;

  let isDisposed = false;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let initialPollInterval: ReturnType<typeof setInterval> | null = null;
  let waitTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let isWaitingForNewRooms = false;
  let totalClicks = 0;
  let consecutiveNoChange = 0;
  let lastContentCount = 0;
  let lastButtonText = "";
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

  const expandRates = () => {
    if (!expandRoomRates || isDisposed) return;
    const toggles = document.querySelectorAll<HTMLButtonElement>(
      'button[data-testid="room-group-see-more-toggle"], [data-testid="room-group-see-more-toggle"]'
    );
    toggles.forEach((button) => {
      if (button.dataset.aaMpdExpanded === "true") {
        return;
      }
      const text = button.textContent?.toLowerCase() || "";
      if (
        text.includes("hide") ||
        text.includes("fewer") ||
        text.includes("less") ||
        button.getAttribute("aria-expanded") === "true"
      ) {
        button.dataset.aaMpdExpanded = "true";
        return;
      }
      button.dataset.aaMpdExpanded = "true";
      try {
        button.click();
      } catch (err) {
        console.warn("[AA-Hotels-MPD] Error expanding room rate toggle:", err);
      }
    });
  };

  const checkAndExpandTypes = () => {
    if (!expandRoomTypes || isDisposed) return;
    if (totalClicks >= maxClicks) return;

    const moreButton = document.querySelector<HTMLButtonElement>(
      'button[data-testid="rooms-table-see-more-button"], [data-testid="rooms-table-see-more-button"]'
    );

    if (!moreButton) {
      if (totalClicks > 0) {
        clearInitialPoll();
      }
      return;
    }

    clearInitialPoll();

    const currentCount = document.querySelectorAll(
      '[data-testid="room-card"], [data-testid="room-group"]'
    ).length;
    const currentButtonText = moreButton.textContent?.trim() || "";

    if (isWaitingForNewRooms) {
      const hasNewContent =
        currentCount > lastContentCount ||
        (currentButtonText !== "" && currentButtonText !== lastButtonText);

      if (hasNewContent) {
        isWaitingForNewRooms = false;
        consecutiveNoChange = 0;
        clearWaitTimeout();
      } else {
        // Still waiting for response or render
        return;
      }
    }

    const isBusy =
      moreButton.disabled ||
      moreButton.getAttribute("aria-disabled") === "true" ||
      moreButton.hasAttribute("data-loading");

    if (isBusy) {
      scheduleCheck(pollIntervalMs);
      return;
    }

    lastContentCount = currentCount;
    lastButtonText = currentButtonText;
    totalClicks++;
    isWaitingForNewRooms = true;

    clearWaitTimeout();
    waitTimeoutTimer = setTimeout(() => {
      if (isWaitingForNewRooms && !isDisposed) {
        consecutiveNoChange++;
        isWaitingForNewRooms = false;
        if (consecutiveNoChange < maxConsecutiveNoChange) {
          scheduleCheck(pollIntervalMs);
        } else {
          console.warn(
            "[AA-Hotels-MPD] Stopped room expansion: no new rooms appeared after multiple attempts."
          );
        }
      }
    }, waitTimeoutMs);

    try {
      moreButton.click();
    } catch (err) {
      console.warn("[AA-Hotels-MPD] Error clicking see more button:", err);
      isWaitingForNewRooms = false;
      clearWaitTimeout();
    }

    scheduleCheck(postClickDelayMs);
  };

  const scheduleCheck = (delayMs: number) => {
    if (isDisposed) return;
    clearScheduledTimer();
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      checkAndExpandTypes();
      if (expandRoomRates) {
        expandRates();
      }
    }, delayMs);
  };

  // Initial poll to find the button if not immediately present
  if (expandRoomTypes) {
    scheduleCheck(100);
    initialPollInterval = setInterval(() => {
      initialPollElapsedMs += INITIAL_POLL_STEP_MS;
      if (initialPollElapsedMs >= maxInitialWaitMs || isDisposed) {
        clearInitialPoll();
      }
      checkAndExpandTypes();
    }, INITIAL_POLL_STEP_MS);
  }

  // Initial expansion of rates
  if (expandRoomRates) {
    setTimeout(expandRates, 200);
  }

  const onMutation = () => {
    if (isDisposed) return;
    if (expandRoomTypes) {
      scheduleCheck(50);
    }
    if (expandRoomRates) {
      expandRates();
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
  let useAllInPricing = true;

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get([
        "expandRoomRates",
        "expandRoomTypes",
        "includeBonusMiles",
        "pricingCalculationMethod",
        "useAllInPricing",
      ]);
      expandRoomRates = Boolean(result.expandRoomRates);
      expandRoomTypes = Boolean(result.expandRoomTypes);
      includeBonusMiles = Boolean(result.includeBonusMiles);
      if (result.pricingCalculationMethod) {
        useAllInPricing = result.pricingCalculationMethod === "all_in";
      } else if (typeof result.useAllInPricing === "boolean") {
        useAllInPricing = result.useAllInPricing;
      }
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
    useAllInPricing,
    onCardsProcessed
  );

  const roomExpansion = setupRoomExpansion({
    expandRoomTypes,
    expandRoomRates,
  });

  const observer = new MutationObserver((mutations) => {
    callback(mutations);
    roomExpansion.onMutation();
  });

  observer.observe(targetContainer, { childList: true, subtree: true });

  targetContainer.insertAdjacentElement("beforebegin", maxMPDElem);

  // Initial immediate processing
  callback();

  // Return cleanup teardown function
  return () => {
    roomExpansion.teardown();
    observer.disconnect();
    maxMPDElem.remove();
    resetRateCollector();
  };
};
