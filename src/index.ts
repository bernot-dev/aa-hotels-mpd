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

import { processCard } from "./cards";
import { getNights } from "./nights";
import { extractSearchCriteria, isValidLocation } from "./capture/criteria";
import { queueRatesForDispatch } from "./capture/collector";
import { CapturedRate } from "./types";

// Listen for intercepted network data dispatched by the MAIN world interceptor
if (typeof window !== "undefined") {
  const handleIncomingRates = async (hotels: RawHotelRate[] | undefined) => {
    if (!hotels || hotels.length === 0) return;

    let includeBonusMiles = false;
    let useAllInPricing = true;
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.sync) {
        const result = await chrome.storage.sync.get([
          "includeBonusMiles",
          "pricingCalculationMethod",
          "useAllInPricing",
        ]);
        includeBonusMiles = Boolean(result.includeBonusMiles);
        if (result.pricingCalculationMethod) {
          useAllInPricing = result.pricingCalculationMethod === "all_in";
        } else if (typeof result.useAllInPricing === "boolean") {
          useAllInPricing = result.useAllInPricing;
        }
      }
    } catch {
      // Ignore storage read errors
    }

    const updated = ingestHotelRates(hotels, includeBonusMiles, useAllInPricing);

    // 1. Reactive Upgrade: Immediately re-evaluate any visible hotel cards
    const cards = document.querySelectorAll('[data-testid="hotel-card-pricing"]');
    if (cards.length > 0) {
      const nights = getNights();
      cards.forEach((card) => {
        try {
          processCard(card, nights, includeBonusMiles, useAllInPricing);
        } catch {}
      });
    }

    // 2. Update map pins & summary banner
    if (updated > 0 || hotelMpdRegistry.size > 0) {
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

    // 3. Authoritative DB Ingestion: Queue captured rates directly from the clean API payload
    try {
      const criteria = extractSearchCriteria();
      const firstHotel = hotels[0];
      if (firstHotel?.location && (!isValidLocation(criteria.location) || criteria.location === "Unknown Location")) {
        criteria.location = firstHotel.location;
      }
      if (firstHotel?.checkInDate && !criteria.checkIn) criteria.checkIn = firstHotel.checkInDate;
      if (firstHotel?.checkOutDate && !criteria.checkOut) criteria.checkOut = firstHotel.checkOutDate;
      if (firstHotel?.nights && criteria.nights <= 1) criteria.nights = firstHotel.nights;

      const capturedRates: CapturedRate[] = hotels.map((h) => {
        const effectivePrice = (useAllInPricing && h.allInPrice > 0)
          ? h.allInPrice
          : (h.basePrice > 0 ? h.basePrice : h.price);
        const miles = includeBonusMiles
          ? (h.tieredMiles || h.baseMiles)
          : (h.baseMiles || h.tieredMiles);
        const mpd = effectivePrice > 0 ? miles / effectivePrice : 0;
        return {
          hotelName: h.hotelName,
          hotelId: h.hotelId,
          location: h.location || criteria.location,
          price: effectivePrice,
          miles,
          mpd: Number(mpd.toFixed(1)),
          isTotalPrice: true,
          isBonus: includeBonusMiles && h.tieredMiles > h.baseMiles,
        };
      });

      queueRatesForDispatch(criteria, capturedRates);
    } catch (err) {
      console.debug("[AA-Hotels-MPD] Error dispatching authoritative network rates to DB:", err);
    }
  };

  // 1. Listen for postMessage (cross-world MAIN -> ISOLATED)
  window.addEventListener("message", (event) => {
    if (event.data?.type === "AA_HOTELS_MPD_NETWORK_DATA") {
      handleIncomingRates(event.data.hotels);
    }
  });

  // 2. Also listen for CustomEvent
  window.addEventListener("AA_HOTELS_MPD_NETWORK_DATA", (e: Event) => {
    const customEvent = e as CustomEvent<{ hotels: RawHotelRate[] }>;
    handleIncomingRates(customEvent.detail?.hotels);
  });

  // 3. Hydrate immediately from shared sessionStorage if data arrived before scripts loaded
  try {
    if (typeof sessionStorage !== "undefined") {
      const cached = sessionStorage.getItem("aa_hotels_latest_rates");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          handleIncomingRates(parsed);
        }
      }
    }
  } catch {}
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
