import { initRouter, RouteInfo } from "./router";
import { waitForElement } from "./wait";
import { processDetailsPage } from "./details";
import { processSearchPage } from "./search";
import { mountDebugButton } from "./debug";
import { ingestHotelRates, RawHotelRate, hotelMpdRegistry } from "./registry";
import { updateMapPins } from "./map";

const SEARCH_SELECTOR =
  '[data-testid="hotel-results-list-container"], [data-testid="search-results-map"]';
const DETAILS_SELECTOR = 'div[data-testid="room-group"]';

// Listen for intercepted network data dispatched by the MAIN world interceptor
if (typeof window !== "undefined") {
  window.addEventListener("AA_HOTELS_MPD_NETWORK_DATA", async (e: Event) => {
    const customEvent = e as CustomEvent<{ hotels: RawHotelRate[] }>;
    const hotels = customEvent.detail?.hotels;
    if (!hotels || hotels.length === 0) return;

    let includeBonusMiles = false;
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.sync) {
        const result = await chrome.storage.sync.get(["includeBonusMiles"]);
        includeBonusMiles = Boolean(result.includeBonusMiles);
      }
    } catch {
      // Ignore storage read errors
    }

    const updated = ingestHotelRates(hotels, includeBonusMiles);
    if (updated > 0) {
      updateMapPins(document.body);
      const summaryBanner = document.getElementById("aa-mpd-search-summary");
      if (summaryBanner && hotelMpdRegistry.size > 0) {
        const highest = Math.max(...hotelMpdRegistry.values());
        if (highest > 0) {
          summaryBanner.innerHTML = `Best earn rate on this page: <b>${highest.toFixed(1)} miles/$</b>.`;
          summaryBanner.style.display = "block";
        }
      }
    }
  });
}

let activeTeardown: (() => void) | null = null;
let activeAbortController: AbortController | null = null;
let currentNavEpoch = 0;

async function handleRouteChange(routeInfo: RouteInfo) {
  const thisEpoch = ++currentNavEpoch;

  // 1. Teardown active controller and cancel ongoing wait observers from previous route
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }

  if (activeTeardown) {
    try {
      activeTeardown();
    } catch (err) {
      console.error("[AA-Hotels-MPD] Error during controller teardown:", err);
    }
    activeTeardown = null;
  }

  // 2. Ensure debug button is mounted
  mountDebugButton().catch(console.error);

  // 3. Mount appropriate controller for the current route
  const currentAbort = new AbortController();
  activeAbortController = currentAbort;

  try {
    if (routeInfo.route === "search") {
      const container = await waitForElement(SEARCH_SELECTOR, {
        signal: currentAbort.signal,
      });

      if (thisEpoch !== currentNavEpoch || currentAbort.signal.aborted) {
        return;
      }

      const teardown = await processSearchPage(container, {
        signal: currentAbort.signal,
      });

      if (thisEpoch !== currentNavEpoch || currentAbort.signal.aborted) {
        teardown();
        return;
      }

      activeTeardown = teardown;
    } else if (routeInfo.route === "details") {
      const container = await waitForElement(DETAILS_SELECTOR, {
        signal: currentAbort.signal,
      });

      if (thisEpoch !== currentNavEpoch || currentAbort.signal.aborted) {
        return;
      }

      const teardown = await processDetailsPage(container);

      if (thisEpoch !== currentNavEpoch || currentAbort.signal.aborted) {
        teardown();
        return;
      }

      activeTeardown = teardown;
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Route changed while waiting for element - expected behavior
      return;
    }
    console.error(
      `[AA-Hotels-MPD] Error mounting ${routeInfo.route} page:`,
      err
    );
  }
}

// Start the SPA router
initRouter(handleRouteChange);
