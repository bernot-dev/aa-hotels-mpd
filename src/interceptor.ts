// Network Interceptor running in MAIN world (document_start)
// Intercepts search and hotel API responses, parses hotel rates and miles,
// and dispatches CustomEvent to ISOLATED world content scripts.

export interface RawHotelRate {
  hotelId: string;
  price: number;
  baseMiles: number;
  tieredMiles: number;
}

export const EVENT_NAME = "AA_HOTELS_MPD_NETWORK_DATA";

/**
 * Dispatches intercepted hotel rates across the world boundary via CustomEvent on window.
 */
export function dispatchInterceptedRates(rates: RawHotelRate[]): void {
  if (!rates || rates.length === 0) return;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, {
          detail: { hotels: rates },
        })
      );
    } catch (err) {
      console.debug("[AA-Hotels-MPD] Failed to dispatch network rates event:", err);
    }
  }
}

/**
 * Extracts hotel rates from arbitrary API response objects.
 * Handles Rocket Travel / Rocketmiles schema:
 * - payload.searchResult.results
 * - payload.results
 * - payload.hotels
 * - payload (as an array of hotel objects)
 */
export function extractHotelRatesFromPayload(payload: any): RawHotelRate[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const hotelMap = new Map<string, RawHotelRate>();

  const processHotelItem = (item: any) => {
    if (!item || typeof item !== "object") return;

    const rawId = item.hotel?.id ?? item.id ?? item.hotelId ?? item.propertyId;
    if (rawId === null || rawId === undefined) return;
    const hotelId = String(rawId).trim();
    if (!hotelId || !/^\d+$/.test(hotelId)) return;

    const economics = item.economics;

    let price = 0;
    if (economics?.total?.amount) {
      price = Number(economics.total.amount);
    } else if (economics?.displayPrice?.amount) {
      price = Number(economics.displayPrice.amount);
    } else if (economics?.pricePerNight?.amount) {
      price = Number(economics.pricePerNight.amount);
    } else if (item.lowestAveragePrice?.amount) {
      price = Number(item.lowestAveragePrice.amount);
    } else if (item.totalPrice?.amount) {
      price = Number(item.totalPrice.amount);
    } else if (typeof item.price === "number") {
      price = item.price;
    }

    let baseMiles = 0;
    let tieredMiles = 0;

    if (economics) {
      baseMiles = Number(economics.rewardAmount || 0);
      tieredMiles = Number(economics.rewardAmountTiered || baseMiles);
    } else {
      baseMiles = Number(item.rewardAmount || item.rewardMiles || item.totalRewards || 0);
      tieredMiles = Number(item.rewardAmountTiered || baseMiles);
    }

    if (isNaN(price) || price <= 0) return;
    if (isNaN(baseMiles)) baseMiles = 0;
    if (isNaN(tieredMiles)) tieredMiles = baseMiles;

    if (baseMiles <= 0 && tieredMiles <= 0) return;

    const existing = hotelMap.get(hotelId);
    if (!existing) {
      hotelMap.set(hotelId, { hotelId, price, baseMiles, tieredMiles });
    } else {
      // If hotel already registered, keep the best rate/miles
      const existingMpd = existing.tieredMiles / existing.price;
      const newMpd = tieredMiles / price;
      if (newMpd > existingMpd) {
        hotelMap.set(hotelId, { hotelId, price, baseMiles, tieredMiles });
      }
    }
  };

  // 1. Check standard results array locations
  const candidates: any[] = [];
  if (Array.isArray(payload)) {
    candidates.push(...payload);
  }
  if (Array.isArray(payload.searchResult?.results)) {
    candidates.push(...payload.searchResult.results);
  }
  if (Array.isArray(payload.results)) {
    candidates.push(...payload.results);
  }
  if (Array.isArray(payload.hotels)) {
    candidates.push(...payload.hotels);
  }

  candidates.forEach(processHotelItem);

  // 2. If nothing found in standard top-level arrays, do a bounded shallow scan
  if (hotelMap.size === 0) {
    for (const key of Object.keys(payload)) {
      const val = payload[key];
      if (Array.isArray(val)) {
        val.forEach(processHotelItem);
      } else if (val && typeof val === "object") {
        if (Array.isArray(val.results)) {
          val.results.forEach(processHotelItem);
        }
      }
    }
  }

  return Array.from(hotelMap.values());
}

export function shouldInspectUrl(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes("/search") ||
    lower.includes("/results") ||
    lower.includes("/hotels") ||
    lower.includes("aadvantage-hotels") ||
    lower.includes("/rest/")
  );
}

/**
 * Initializes monkey-patching on window.fetch and XMLHttpRequest.
 * Only runs once.
 */
let isInitialized = false;

export function initNetworkInterceptor(): void {
  if (isInitialized || typeof window === "undefined") return;
  isInitialized = true;

  // 1. Monkey-patch window.fetch
  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const response = await originalFetch.call(this, input, init);
      try {
        const url =
          typeof input === "string"
            ? input
            : "url" in input
            ? input.url
            : input.toString();
        if (shouldInspectUrl(url)) {
          response
            .clone()
            .json()
            .then((data) => {
              const rates = extractHotelRatesFromPayload(data);
              dispatchInterceptedRates(rates);
            })
            .catch(() => {});
        }
      } catch {
        // Ignore inspection errors to never interfere with page functionality
      }
      return response;
    };
  }

  // 2. Monkey-patch XMLHttpRequest
  if (typeof XMLHttpRequest !== "undefined") {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      (this as any)._aaMpdUrl = typeof url === "string" ? url : url.toString();
      return (originalOpen as any).apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      this.addEventListener("load", function () {
        try {
          const url = (this as any)._aaMpdUrl || "";
          if (shouldInspectUrl(url)) {
            const text = this.responseText;
            if (text && (text.startsWith("{") || text.startsWith("["))) {
              const data = JSON.parse(text);
              const rates = extractHotelRatesFromPayload(data);
              dispatchInterceptedRates(rates);
            }
          }
        } catch {
          // Ignore inspection errors
        }
      });
      return originalSend.call(this, body);
    };
  }
}

// Auto-run interceptor when script is executed in MAIN world
if (typeof window !== "undefined") {
  initNetworkInterceptor();
}
