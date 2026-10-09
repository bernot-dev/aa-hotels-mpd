import { extractHotelRatesFromPayload, extractTotalFilteredHotels, EnrichedHotelRate } from "./interceptor";
import {
  ingestHotelRates,
  getCurrentPageBestMPD,
  getLocationBestMPD,
  getSearchTotalResults,
  setSearchTotalResults,
  getConsideredHotelsCount,
  isAllResultsConsidered,
} from "./registry";
import { loadPricingSettings, milesForEarningLevel, DEFAULT_MAX_SEARCH_PAGES } from "./settings";
import { getLogoUrl } from "./logo";
import { extractSearchCriteria } from "./capture/criteria";
import { queueRatesForDispatch } from "./capture/collector";

export interface BackgroundSearchQueryOptions {
  expandSearchResults: boolean;
  maxSearchPages?: number;
  delayMs?: number;
  jitterMs?: number;
  fetchFn?: typeof fetch;
  onPageLoaded?: (pageNum: number, rates: EnrichedHotelRate[]) => void;
}

export interface CapturedSearchRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

let backgroundSearchLoading = false;
let activeJobId = 0;

export function isBackgroundSearchLoading(): boolean {
  return backgroundSearchLoading;
}

export function setBackgroundSearchLoading(loading: boolean): void {
  backgroundSearchLoading = loading;
}

export interface SummaryBannerOptions {
  isLoadingOverride?: boolean;
  totalHotels?: number | null;
  consideredHotels?: number;
  allCovered?: boolean;
}

export function updateSummaryBanner(
  bannerElem: HTMLElement,
  maxMPD: number,
  optionsOrLoading?: boolean | SummaryBannerOptions
): void {
  if (maxMPD <= 0) return;
  const logoUrl = getLogoUrl(32);
  const isDetails = bannerElem.id === "aa-mpd-details-summary";

  if (isDetails) {
    const html = `<img class="aa-mpd-banner-logo" src="${logoUrl}" alt="" aria-hidden="true" width="28" height="28" /><span class="aa-mpd-banner-text">Best earn rate on this page: <b>${maxMPD.toFixed(1)} miles/$</b>.</span>`;
    if (bannerElem.innerHTML !== html) {
      bannerElem.innerHTML = html;
    }
    bannerElem.style.display = "block";
    return;
  }

  const opts: SummaryBannerOptions =
    typeof optionsOrLoading === "boolean"
      ? { isLoadingOverride: optionsOrLoading }
      : optionsOrLoading || {};

  const loading =
    typeof opts.isLoadingOverride === "boolean"
      ? opts.isLoadingOverride
      : isBackgroundSearchLoading();

  let totalCount =
    typeof opts.totalHotels === "number"
      ? opts.totalHotels
      : getSearchTotalResults();

  let consideredCount =
    typeof opts.consideredHotels === "number"
      ? opts.consideredHotels
      : getConsideredHotelsCount();

  if (typeof document !== "undefined") {
    const domCards = document.querySelectorAll(
      'li.PropertyCardItem, [data-selenium="hotel-item"], [data-element-name="property-card"], [data-testid="hotel-card-pricing"]'
    ).length;
    consideredCount = Math.max(consideredCount, domCards);

    if (totalCount === null) {
      const statusElem = document.querySelector('[data-testid="search-result-update"]');
      const match = statusElem?.textContent?.match(/(\d+)\s+properties found/i);
      if (match) {
        totalCount = Number(match[1]);
      } else {
        const pageCountText = document.querySelector('#paginationPageCount, [data-selenium="pagination-text"]')?.textContent || "";
        if (pageCountText.includes("Page 1 of 1") && domCards > 0) {
          totalCount = domCards;
        }
      }
    }
  }

  const allCovered =
    typeof opts.allCovered === "boolean"
      ? opts.allCovered
      : (typeof totalCount === "number" && totalCount > 0 && consideredCount >= totalCount) ||
        isAllResultsConsidered();

  let consideredSuffix = "";
  if (consideredCount > 0) {
    if (typeof totalCount === "number" && totalCount > 0) {
      consideredSuffix = ` (considering ${consideredCount} of ${totalCount} properties)`;
    } else {
      consideredSuffix = ` (considering ${consideredCount} properties)`;
    }
  }

  const spinningClass = loading ? " aa-mpd-spinning" : "";
  const alertMsg = loading
    ? "Searching additional pages... There may be better deals on additional pages."
    : "There may be better deals on additional pages.";

  const headerHtml = `<div class="aa-mpd-banner-header"><img class="aa-mpd-banner-logo${spinningClass}" src="${logoUrl}" alt="" aria-hidden="true" width="28" height="28" /><span class="aa-mpd-banner-text">Best earn rate for this location: <b>${maxMPD.toFixed(1)} miles/$</b>${consideredSuffix}.</span></div>`;
  const alertHtml = !allCovered
    ? `<div class="aa-mpd-banner-alert-row"><span class="aa-mpd-banner-alert">${alertMsg}</span></div>`
    : "";

  const html = `${headerHtml}${alertHtml}`;
  if (bannerElem.innerHTML !== html) {
    bannerElem.innerHTML = html;
  }
  bannerElem.style.display = "block";
}

export function updateAllSearchBanners(): void {
  if (typeof document === "undefined") return;
  const banner = document.getElementById("aa-mpd-search-summary");
  if (!banner) return;
  const bestMPD = getLocationBestMPD() || getCurrentPageBestMPD();
  if (bestMPD > 0) {
    updateSummaryBanner(banner, bestMPD, isBackgroundSearchLoading());
  }
}

export function findSearchRequestPage(body: any): { key: string; page: any } | null {
  let parsed = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed?.variables || typeof parsed.variables !== "object") return null;
  for (const key of Object.keys(parsed.variables)) {
    const sr = parsed.variables[key]?.searchRequest;
    if (sr && sr.page) {
      return { key, page: sr.page };
    }
  }
  return null;
}

export function createPageRequestBody(body: any, pageNumber: number): any {
  let parsed = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return body;
    }
  }
  const cloned = JSON.parse(JSON.stringify(parsed));
  const pageInfo = findSearchRequestPage(cloned);
  if (pageInfo) {
    pageInfo.page.pageNumber = pageNumber;
    pageInfo.page.pageToken = "";
  }
  return cloned;
}

export async function runBackgroundSearchQueries(
  request: CapturedSearchRequest,
  options: BackgroundSearchQueryOptions
): Promise<{ queriedPages: number; totalHotelsFound: number }> {
  if (!options.expandSearchResults) {
    return { queriedPages: 0, totalHotelsFound: 0 };
  }

  const pageInfo = findSearchRequestPage(request.body);
  if (!pageInfo) {
    return { queriedPages: 0, totalHotelsFound: 0 };
  }

  const maxPages = options.maxSearchPages ?? DEFAULT_MAX_SEARCH_PAGES;
  if (maxPages <= 1) {
    return { queriedPages: 0, totalHotelsFound: 0 };
  }

  const delayMs = options.delayMs ?? 3000;
  const jitterMs = options.jitterMs ?? 2000;
  const fetchImpl = options.fetchFn ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchImpl) {
    return { queriedPages: 0, totalHotelsFound: 0 };
  }

  const jobId = ++activeJobId;
  backgroundSearchLoading = true;
  updateAllSearchBanners();

  let queriedPages = 0;
  let totalHotelsFound = 0;

  try {
    for (let pageNum = 2; pageNum <= maxPages; pageNum++) {
      // 3s delay with 2s jitter
      const jitter = Math.random() * jitterMs;
      const delay = delayMs + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Check if job was aborted or superseded by a newer search
      if (activeJobId !== jobId) break;

      const nextBody = createPageRequestBody(request.body, pageNum);
      const headers = {
        ...request.headers,
        "content-type": "application/json",
        "x-aa-mpd-background": "true",
      };

      try {
        const res = await fetchImpl(request.url, {
          method: "POST",
          headers,
          body: JSON.stringify(nextBody),
          credentials: "same-origin",
        });

        if (!res.ok) {
          console.debug(`[AA-Hotels-MPD] Background query page ${pageNum} returned status ${res.status}`);
          break;
        }

        const data = await res.json();
        const total = extractTotalFilteredHotels(data);
        if (typeof total === "number") {
          setSearchTotalResults(total);
        }
        const rates = extractHotelRatesFromPayload(data, nextBody);
        queriedPages++;

        if (!rates || rates.length === 0) {
          // No more hotels returned on this page; stop further pagination
          break;
        }

        totalHotelsFound += rates.length;

        // Ingest into registry
        const { earningLevel, useAllInPricing } = await loadPricingSettings();
        ingestHotelRates(rates, earningLevel, useAllInPricing);

        // Update all search banners with new best rate across location
        updateAllSearchBanners();

        // Optional callback for observers / testing
        options.onPageLoaded?.(pageNum, rates);

        // Queue for DB storage
        try {
          const criteria = extractSearchCriteria();
          const capturedRates = rates.map((h) => {
            const effectivePrice =
              useAllInPricing && h.allInPrice > 0 ? h.allInPrice : h.basePrice > 0 ? h.basePrice : h.price;
            const miles = milesForEarningLevel(h.baseMiles, h.tieredMiles, earningLevel);
            const mpd = effectivePrice > 0 ? miles / effectivePrice : 0;
            return {
              hotelName: h.hotelName,
              hotelId: h.hotelId,
              location: h.location || criteria.location,
              price: effectivePrice,
              basePrice: h.basePrice,
              allInPrice: h.allInPrice,
              miles,
              mpd: Number(mpd.toFixed(1)),
              isTotalPrice: true,
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
        } catch {
          // Non-critical DB queueing
        }
      } catch (err) {
        console.debug(`[AA-Hotels-MPD] Background query page ${pageNum} error:`, err);
        break;
      }
    }
  } finally {
    if (activeJobId === jobId) {
      backgroundSearchLoading = false;
      updateAllSearchBanners();
    }
  }

  return { queriedPages, totalHotelsFound };
}

export function abortBackgroundSearchQueries(): void {
  activeJobId++;
  if (backgroundSearchLoading) {
    backgroundSearchLoading = false;
    updateAllSearchBanners();
  }
}
