import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clearHotelMpdRegistry,
  ingestHotelRates,
  setSearchTotalResults,
  getSearchTotalResults,
  getConsideredHotelsCount,
  isAllResultsConsidered,
  getLocationBestMPD,
} from "../src/registry";
import {
  updateSummaryBanner,
  updateAllSearchBanners,
  runBackgroundSearchQueries,
  CapturedSearchRequest,
  setBackgroundSearchLoading,
} from "../src/search-query";
import {
  extractTotalFilteredHotels,
  dispatchInterceptedRates,
} from "../src/interceptor";
import { setupSearchExpansion } from "../src/search";

const getGlobalChrome = (): any => (globalThis as any).chrome;
const setGlobalChrome = (mock: any): void => {
  (globalThis as any).chrome = mock;
};

describe("Total Results and Best Earn Rate Banner Automation Tests", () => {
  let summaryBanner: HTMLElement;
  const originalChrome = getGlobalChrome();

  beforeEach(() => {
    clearHotelMpdRegistry();
    document.body.innerHTML = "";
    summaryBanner = document.createElement("div");
    summaryBanner.id = "aa-mpd-search-summary";
    document.body.appendChild(summaryBanner);
    sessionStorage.clear();
    setBackgroundSearchLoading(false);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setGlobalChrome(originalChrome);
    vi.restoreAllMocks();
  });

  describe("Scenario A: Wilmington, NC - 64 Total Results (1 UI page, all results considered)", () => {
    it("hides the additional pages alert when all 64 results are loaded and considered", () => {
      // 1. Intercept GraphQL response containing 64 totalFilteredHotels
      const mockWilmingtonPayload = {
        data: {
          citySearch: {
            searchResult: {
              searchInfo: {
                totalFilteredHotels: 64,
              },
            },
          },
        },
      };

      const totalFound = extractTotalFilteredHotels(mockWilmingtonPayload);
      expect(totalFound).toBe(64);

      // 2. Set total results into registry
      setSearchTotalResults(64);
      expect(getSearchTotalResults()).toBe(64);

      // 3. Ingest 64 hotels into registry
      const mockHotels = Array.from({ length: 64 }, (_, i) => ({
        hotelId: `wilmington-hotel-${i + 1}`,
        hotelName: `Wilmington Hotel ${i + 1}`,
        price: 100,
        basePrice: 100,
        allInPrice: 100,
        baseMiles: i === 0 ? 2850 : 1500, // Best rate: 28.5 miles/$
        tieredMiles: i === 0 ? 2850 : 1500,
      }));
      ingestHotelRates(mockHotels as any, "status_cardmember", true);

      expect(getConsideredHotelsCount()).toBe(64);
      expect(isAllResultsConsidered()).toBe(true);

      // 4. Update banner
      updateSummaryBanner(summaryBanner, 28.5);

      // 5. Verify banner format and text
      const bannerText = summaryBanner.querySelector(".aa-mpd-banner-text");
      expect(bannerText).not.toBeNull();
      expect(bannerText?.textContent).toBe(
        "Best earn rate for this location: 28.5 miles/$ (considering 64 of 64 properties)."
      );

      // 6. Verify alert banner is hidden (not rendered when all results are covered)
      const alertRow = summaryBanner.querySelector<HTMLElement>(".aa-mpd-banner-alert-row");
      expect(alertRow).toBeNull();
      expect(summaryBanner.querySelector(".aa-mpd-banner-alert")).toBeNull();
    });
  });

  describe("Scenario B: Miami, FL - 690 Total Results (>1 UI page, partial results considered)", () => {
    it("displays the additional pages alert on a separate line below the best earn rate", () => {
      // 1. Intercept GraphQL response containing 690 totalFilteredHotels
      const mockMiamiPayload = {
        data: {
          citySearch: {
            searchResult: {
              searchInfo: {
                totalFilteredHotels: 690,
              },
            },
          },
        },
      };

      const totalFound = extractTotalFilteredHotels(mockMiamiPayload);
      expect(totalFound).toBe(690);

      // 2. Set total results into registry
      setSearchTotalResults(690);
      expect(getSearchTotalResults()).toBe(690);

      // 3. Ingest 225 hotels (5 background pages of 45 results)
      const mockHotels = Array.from({ length: 225 }, (_, i) => ({
        hotelId: `miami-hotel-${i + 1}`,
        hotelName: `Miami Hotel ${i + 1}`,
        price: 100,
        basePrice: 100,
        allInPrice: 100,
        baseMiles: i === 0 ? 2850 : 1200, // Best rate: 28.5 miles/$
        tieredMiles: i === 0 ? 2850 : 1200,
      }));
      ingestHotelRates(mockHotels as any, "status_cardmember", true);

      expect(getConsideredHotelsCount()).toBe(225);
      expect(isAllResultsConsidered()).toBe(false);

      // 4. Update banner
      updateSummaryBanner(summaryBanner, 28.5);

      // 5. Verify banner format displays considering 225 of 690 properties
      const bannerText = summaryBanner.querySelector(".aa-mpd-banner-text");
      expect(bannerText).not.toBeNull();
      expect(bannerText?.textContent).toBe(
        "Best earn rate for this location: 28.5 miles/$ (considering 225 of 690 properties)."
      );

      // 6. Verify alert banner is on the line below and VISIBLE
      const alertRow = summaryBanner.querySelector<HTMLElement>(".aa-mpd-banner-alert-row");
      expect(alertRow).not.toBeNull();
      expect(alertRow?.style.display).not.toBe("none");

      const alertPill = alertRow?.querySelector(".aa-mpd-banner-alert");
      expect(alertPill).not.toBeNull();
      expect(alertPill?.textContent).toBe("There may be better deals on additional pages.");

      // 7. Verify two-line layout structure:
      // Line 1 is .aa-mpd-banner-header
      // Line 2 is .aa-mpd-banner-alert-row
      const headerRow = summaryBanner.querySelector(".aa-mpd-banner-header");
      expect(headerRow).not.toBeNull();
      expect(headerRow?.contains(alertPill!)).toBe(false); // Alert is NOT inline in header row
      expect(alertRow?.previousElementSibling).toBe(headerRow);
    });
  });

  describe("Background Search Queries & Coverage Automation", () => {
    it("ingests totalFilteredHotels during background queries and hides alert when all results are retrieved", async () => {
      const mockRequest: CapturedSearchRequest = {
        url: "https://www.aadvantagehotels.com/api/graphql",
        headers: {},
        body: {
          operationName: "CitySearch",
          variables: {
            CitySearchRequest: {
              searchRequest: {
                page: { pageSize: 45, pageNumber: 1, pageToken: "" },
              },
            },
          },
        },
      };

      // Mock fetch returning page 2 with totalFilteredHotels: 64 and remainder 19 hotels
      const fetchFn = vi.fn().mockImplementation(async (_url: string, init: any) => {
        const reqBody = JSON.parse(init.body);
        const pageNum = reqBody.variables.CitySearchRequest.searchRequest.page.pageNumber;

        if (pageNum === 2) {
          return {
            ok: true,
            json: async () => ({
              searchResult: {
                searchInfo: { totalFilteredHotels: 64 },
                results: Array.from({ length: 19 }, (_, i) => ({
                  hotel: { id: `wilmington-p2-${i + 1}`, name: `Wilmington P2 Hotel ${i + 1}` },
                  economics: {
                    total: { amount: 100 },
                    rewardAmount: 2000,
                    rewardAmountTiered: 2500,
                  },
                })),
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            searchResult: {
              results: [],
            },
          }),
        };
      });

      // Initially ingest 45 hotels from page 1
      const page1Hotels = Array.from({ length: 45 }, (_, i) => ({
        hotelId: `wilmington-p1-${i + 1}`,
        hotelName: `Wilmington P1 Hotel ${i + 1}`,
        price: 100,
        basePrice: 100,
        allInPrice: 100,
        baseMiles: 2000,
        tieredMiles: 2500,
      }));
      ingestHotelRates(page1Hotels as any, "status_cardmember", true);

      // Run background search queries with maxSearchPages: 2
      const res = await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: true,
        maxSearchPages: 2,
        delayMs: 0,
        jitterMs: 0,
        fetchFn,
      });

      expect(res.queriedPages).toBe(1);
      expect(res.totalHotelsFound).toBe(19);

      // Now registry has 45 + 19 = 64 hotels, and totalFilteredHotels = 64
      expect(getSearchTotalResults()).toBe(64);
      expect(getConsideredHotelsCount()).toBe(64);
      expect(isAllResultsConsidered()).toBe(true);

      // Verify banner hides alert
      updateAllSearchBanners();
      const alertRow = summaryBanner.querySelector<HTMLElement>(".aa-mpd-banner-alert-row");
      expect(alertRow).toBeNull();
      expect(summaryBanner.querySelector(".aa-mpd-banner-alert")).toBeNull();
    });
  });

  describe("Programmatic Infinite-Scroll Tile Expansion Automation", () => {
    it("scrolls down towards pagination and restores viewport scroll to top until all tiles are loaded", async () => {
      // Setup total search results
      setSearchTotalResults(64);

      // Initial page setup: 11 cards in DOM (typical Agoda initial chunk)
      const listContainer = document.createElement("div");
      listContainer.id = "searchPageRightColumn";
      for (let i = 0; i < 11; i++) {
        const card = document.createElement("div");
        card.className = "PropertyCardItem";
        card.setAttribute("data-selenium", "hotel-item");
        listContainer.appendChild(card);
      }
      const paginationPanel = document.createElement("div");
      paginationPanel.setAttribute("data-selenium", "pagination-panel");
      listContainer.appendChild(paginationPanel);
      document.body.appendChild(listContainer);

      let scrollHistory: number[] = [];
      window.scrollY = 0;
      window.scrollTo = vi.fn().mockImplementation((options: any) => {
        if (typeof options === "object" && typeof options.top === "number") {
          window.scrollY = options.top;
          scrollHistory.push(options.top);
        }
      });

      let scrollIntoViewCalled = false;
      paginationPanel.scrollIntoView = vi.fn().mockImplementation(() => {
        scrollIntoViewCalled = true;
      });

      const expansionController = setupSearchExpansion({
        expandSearchResults: true,
        pollIntervalMs: 20,
        postClickDelayMs: 20,
        waitTimeoutMs: 100,
      });

      // Wait 130ms: initial check (scheduled at 100ms) runs Step A and triggers scrollIntoView
      await new Promise((r) => setTimeout(r, 130));
      expect(scrollIntoViewCalled).toBe(true);

      // Simulate more cards hydrated by browser
      for (let i = 11; i < 64; i++) {
        const card = document.createElement("div");
        card.className = "PropertyCardItem";
        card.setAttribute("data-selenium", "hotel-item");
        listContainer.insertBefore(card, paginationPanel);
      }

      // Notify mutation or wait for poll interval (20ms) to trigger Step B
      expansionController.onMutation();
      await new Promise((r) => setTimeout(r, 80));
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
      expect(window.scrollY).toBe(0);

      // Now all 64 cards are present, which matches searchTotalResults (64)
      expect(document.querySelectorAll(".PropertyCardItem").length).toBe(64);

      expansionController.teardown();
    });
  });
});
