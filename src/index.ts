import { initRouter, RouteInfo, isSensitiveCheckoutPage } from "./router";
import { waitForElement } from "./wait";
import { processDetailsPage } from "./details";
import { processSearchPage } from "./search";
import { mountDebugButton } from "./debug";
import { loadPricingSettings, loadSearchSettings, milesForEarningLevel } from "./settings";
import {
  ingestHotelRates,
  RawHotelRate,
  hotelMpdRegistry,
  getCurrentPageBestMPD,
  getLocationBestMPD,
  setSearchTotalResults,
} from "./registry";
import { updateMapPins } from "./map";
import { ingestRoomRates } from "./allin";
import type { RoomRate } from "./interceptor";
import { updateSummaryBanner, runBackgroundSearchQueries, abortBackgroundSearchQueries } from "./search-query";

const SEARCH_SELECTOR =
  '#searchPageRightColumn, #contentContainer, [data-selenium="pagination-panel"], #searchPageReactRoot';
// Wait for the room grid itself: the page shell (#property-critical-root) renders well before it
const DETAILS_SELECTOR =
  '#property-room-grid-root, [data-element-name="property-room-grid-root"], [data-selenium="room-grid"]';

import { processCard, innermostCards, CARD_SELECTOR, ROOM_CARD_SELECTOR } from "./cards";
import { getNights } from "./nights";
import { extractSearchCriteria, normalizeLocation } from "./capture/criteria";
import { queueRatesForDispatch } from "./capture/collector";
import { CapturedRate } from "./types";

// Listen for intercepted network data dispatched by the MAIN world interceptor
if (typeof window !== "undefined") {
  const handleIncomingRates = async (
    hotels: RawHotelRate[] | undefined,
    totalHotels?: number | null,
    searchKey?: string,
    totalIsSettled?: boolean
  ) => {
    if (isSensitiveCheckoutPage(window.location.href)) return;
    if (!hotels || hotels.length === 0) {
      if (typeof totalHotels === "number") setSearchTotalResults(totalHotels, searchKey, totalIsSettled);
      return;
    }

    const { includeBonusMiles, useAllInPricing, earningLevel } = await loadPricingSettings();

    // Ingest first: a new search clears the registry, including the previous search's total
    const updated = ingestHotelRates(hotels, earningLevel, useAllInPricing);
    if (typeof totalHotels === "number") {
      setSearchTotalResults(totalHotels, searchKey, totalIsSettled);
    }

    // 1. Reactive Upgrade: Immediately re-evaluate any visible hotel cards
    let bestCardMpd = 0;
    const cards = innermostCards(document.querySelectorAll(CARD_SELECTOR));
    if (cards.length > 0) {
      const nights = getNights();
      cards.forEach((card) => {
        try {
          const { cardMaxMPD } = processCard(card, nights, includeBonusMiles, useAllInPricing, true, earningLevel);
          bestCardMpd = Math.max(bestCardMpd, cardMaxMPD);
        } catch {}
      });
    }

    // 2. Update map pins & summary banner
    if (updated > 0 || hotelMpdRegistry.size > 0) {
      updateMapPins(document.body, useAllInPricing);
      const summaryBanner = document.getElementById("aa-mpd-search-summary");
      const highest = Math.max(bestCardMpd, getLocationBestMPD(), getCurrentPageBestMPD());
      if (summaryBanner && highest > 0) {
        updateSummaryBanner(summaryBanner, highest);
      }
    }

    // 3. Authoritative DB Ingestion: Queue captured rates directly from the clean API payload
    try {
      const criteria = extractSearchCriteria();
      const firstHotel = hotels[0];
      const canonicalSearchLoc = normalizeLocation(firstHotel?.location || criteria.location);
      if (canonicalSearchLoc) {
        criteria.location = canonicalSearchLoc;
      }
      if (firstHotel?.checkInDate && !criteria.checkIn) criteria.checkIn = firstHotel.checkInDate;
      if (firstHotel?.checkOutDate && !criteria.checkOut) criteria.checkOut = firstHotel.checkOutDate;
      if (firstHotel?.nights && criteria.nights <= 1) criteria.nights = firstHotel.nights;

      const capturedRates: CapturedRate[] = hotels.map((h) => {
        const effectivePrice = (useAllInPricing && h.allInPrice > 0)
          ? h.allInPrice
          : (h.basePrice > 0 ? h.basePrice : h.price);
        const miles = milesForEarningLevel(h.baseMiles, h.tieredMiles, earningLevel);
        const mpd = effectivePrice > 0 ? miles / effectivePrice : 0;
        const hotelLoc = normalizeLocation(h.location || criteria.location) || criteria.location;
        return {
          hotelName: h.hotelName,
          hotelId: h.hotelId,
          location: hotelLoc,
          price: effectivePrice,
          basePrice: h.basePrice,
          allInPrice: h.allInPrice,
          miles,
          mpd: Number(mpd.toFixed(1)),
          isTotalPrice: true,
          // The results API carries base miles only; promotional bonus miles aren't in it
          isBonus: false,
          stars: h.stars,
          rating: h.rating,
          reviewCount: h.reviewCount,
          imageUrl: h.imageUrl,
          refundable: h.refundable,
          neighborhood: h.neighborhood,
          country: h.country,
          checkIn: h.checkInDate || criteria.checkIn,
          checkOut: h.checkOutDate || criteria.checkOut,
        };
      });

      queueRatesForDispatch(criteria, capturedRates);
    } catch (err) {
      console.debug("[AA-Hotels-MPD] Error dispatching authoritative network rates to DB:", err);
    }
  };

  // Details page room rates: remember them, then show all-in prices on any room cards already rendered
  const handleIncomingRooms = async (rooms: RoomRate[] | undefined) => {
    if (!rooms || rooms.length === 0) return;
    ingestRoomRates(rooms);

    const { includeBonusMiles, useAllInPricing, earningLevel } = await loadPricingSettings();
    if (!useAllInPricing) return;

    const nights = getNights();
    document.querySelectorAll(ROOM_CARD_SELECTOR).forEach((card) => {
      try {
        processCard(card, nights, includeBonusMiles, useAllInPricing, false, earningLevel);
      } catch {
        // Skip cards that are mid-render
      }
    });
  };

  // 1. Listen for postMessage (cross-world MAIN -> ISOLATED)
  window.addEventListener("message", async (event) => {
    if (event.data?.type === "AA_HOTELS_MPD_NETWORK_DATA") {
      handleIncomingRates(event.data.hotels, event.data.totalHotels, event.data.searchKey, event.data.totalIsSettled);
      handleIncomingRooms(event.data.rooms);
    } else if (event.data?.type === "AA_HOTELS_CAPTURED_SEARCH_REQUEST") {
      try {
        const { url, headers, body } = event.data;
        const searchSettings = await loadSearchSettings();
        if (searchSettings.expandSearchResults) {
          runBackgroundSearchQueries(
            { url, headers, body },
            {
              expandSearchResults: searchSettings.expandSearchResults,
              maxSearchResults: searchSettings.maxSearchResults,
            }
          );
        }
      } catch (err) {
        console.debug("[AA-Hotels-MPD] Error launching background search queries:", err);
      }
    }
  });

  // 2. Also listen for CustomEvent
  window.addEventListener("AA_HOTELS_MPD_NETWORK_DATA", (e: Event) => {
    const customEvent = e as CustomEvent<{
      hotels: RawHotelRate[];
      totalHotels?: number;
      searchKey?: string;
      totalIsSettled?: boolean;
    }>;
    const { hotels, totalHotels, searchKey, totalIsSettled } = customEvent.detail || {};
    handleIncomingRates(hotels, totalHotels, searchKey, totalIsSettled);
  });

  // 3. Hydrate immediately from shared sessionStorage if data arrived before scripts loaded
  try {
    if (typeof sessionStorage !== "undefined") {
      const cachedTotal = sessionStorage.getItem("aa_hotels_latest_total");
      if (cachedTotal) {
        const parsedTotal = Number(cachedTotal);
        if (!isNaN(parsedTotal) && parsedTotal > 0) {
          setSearchTotalResults(parsedTotal);
        }
      }
      const cached = sessionStorage.getItem("aa_hotels_latest_rates");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          handleIncomingRates(parsed);
        }
      }
      const cachedRooms = sessionStorage.getItem("aa_hotels_latest_rooms");
      if (cachedRooms) {
        const parsed = JSON.parse(cachedRooms);
        if (Array.isArray(parsed) && parsed.length > 0) {
          handleIncomingRooms(parsed);
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

  // Abort any active background search queries
  abortBackgroundSearchQueries();

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

  // 2. Ensure debug button is mounted (never on checkout pages)
  if (isSensitiveCheckoutPage(routeInfo.url) || routeInfo.route === "other") {
    return;
  }
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
