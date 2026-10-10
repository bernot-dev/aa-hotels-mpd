import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findSearchRequestPage,
  createPageRequestBody,
  updateSummaryBanner,
  updateAllSearchBanners,
  runBackgroundSearchQueries,
  abortBackgroundSearchQueries,
  isBackgroundSearchLoading,
  setBackgroundSearchLoading,
  CapturedSearchRequest,
  BACKGROUND_PAGE_SIZE,
} from "../src/search-query";
import {
  clearHotelMpdRegistry,
  getHotelMPD,
  getEnrichedHotel,
  ingestHotelRates,
  getCurrentPageBestMPD,
} from "../src/registry";

describe("search-query module", () => {
  beforeEach(() => {
    clearHotelMpdRegistry();
    abortBackgroundSearchQueries();
    document.body.innerHTML = "";
    (globalThis as any).chrome = {
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({
            earningLevel: "status_cardmember",
            includeBonusMiles: false,
            useAllInPricing: true,
          }),
        },
      },
    };
  });

  afterEach(() => {
    abortBackgroundSearchQueries();
    delete (globalThis as any).chrome;
  });

  describe("findSearchRequestPage", () => {
    it("returns null for non-object, empty, or invalid input", () => {
      expect(findSearchRequestPage(null)).toBeNull();
      expect(findSearchRequestPage(undefined)).toBeNull();
      expect(findSearchRequestPage("not-json")).toBeNull();
      expect(findSearchRequestPage({})).toBeNull();
      expect(findSearchRequestPage({ variables: {} })).toBeNull();
      expect(findSearchRequestPage({ variables: { Search: {} } })).toBeNull();
    });

    it("locates searchRequest.page in parsed object or JSON string", () => {
      const payload = {
        operationName: "CitySearch",
        variables: {
          CitySearchRequest: {
            searchRequest: {
              page: { pageSize: 45, pageNumber: 1, pageToken: "abc" },
            },
          },
        },
      };

      const result = findSearchRequestPage(payload);
      expect(result).not.toBeNull();
      expect(result?.key).toBe("CitySearchRequest");
      expect(result?.page.pageNumber).toBe(1);

      // Also works when passed as stringified JSON
      const stringResult = findSearchRequestPage(JSON.stringify(payload));
      expect(stringResult).not.toBeNull();
      expect(stringResult?.key).toBe("CitySearchRequest");
    });
  });

  describe("createPageRequestBody", () => {
    it("creates a clone with updated pageNumber and cleared pageToken without mutating original", () => {
      const original = {
        operationName: "CitySearch",
        variables: {
          CitySearchRequest: {
            searchRequest: {
              page: { pageSize: 45, pageNumber: 1, pageToken: "initial-token" },
            },
          },
        },
      };

      const updated = createPageRequestBody(original, 3);
      expect(updated.variables.CitySearchRequest.searchRequest.page.pageNumber).toBe(3);
      expect(updated.variables.CitySearchRequest.searchRequest.page.pageToken).toBe("");

      // Original must remain untouched
      expect(original.variables.CitySearchRequest.searchRequest.page.pageNumber).toBe(1);
      expect(original.variables.CitySearchRequest.searchRequest.page.pageToken).toBe("initial-token");
    });

    it("handles stringified JSON input", () => {
      const jsonStr = JSON.stringify({
        variables: {
          CitySearchRequest: {
            searchRequest: {
              page: { pageSize: 45, pageNumber: 1, pageToken: "tok" },
            },
          },
        },
      });

      const updated = createPageRequestBody(jsonStr, 4);
      expect(updated.variables.CitySearchRequest.searchRequest.page.pageNumber).toBe(4);
      expect(updated.variables.CitySearchRequest.searchRequest.page.pageToken).toBe("");
    });
  });

  describe("updateSummaryBanner", () => {
    it("formats details banner without spinning logo or search alert", () => {
      const banner = document.createElement("div");
      banner.id = "aa-mpd-details-summary";

      updateSummaryBanner(banner, 18.5);

      expect(banner.style.display).toBe("block");
      expect(banner.innerHTML).toContain("Best earn rate on this page: <b>18.5 miles/$</b>.");
      expect(banner.innerHTML).not.toContain("aa-mpd-spinning");
      expect(banner.querySelector(".aa-mpd-banner-alert")).toBeNull();
    });

    it("formats search banner with 'Best earn rate for this location', alert, and not spinning when idle", () => {
      const banner = document.createElement("div");
      banner.id = "aa-mpd-search-summary";
      setBackgroundSearchLoading(false);

      updateSummaryBanner(banner, 22.4);

      expect(banner.style.display).toBe("block");
      expect(banner.innerHTML).toContain("Best earn rate for this location: <b>22.4 miles/$</b>.");
      expect(banner.innerHTML).not.toContain("aa-mpd-spinning");
      const alertElem = banner.querySelector(".aa-mpd-banner-alert");
      expect(alertElem).not.toBeNull();
      expect(alertElem?.textContent).toBe("There may be better deals on additional pages.");
    });

    it("formats search banner with spinning logo and active search alert when loading", () => {
      const banner = document.createElement("div");
      banner.id = "aa-mpd-search-summary";
      setBackgroundSearchLoading(true);

      updateSummaryBanner(banner, 22.4);

      expect(banner.innerHTML).toContain("aa-mpd-spinning");
      const alertElem = banner.querySelector(".aa-mpd-banner-alert");
      expect(alertElem?.textContent).toBe(
        "Searching additional pages... There may be better deals on additional pages."
      );
    });

    it("does nothing when maxMPD is <= 0", () => {
      const banner = document.createElement("div");
      banner.id = "aa-mpd-search-summary";

      updateSummaryBanner(banner, 0);
      expect(banner.innerHTML).toBe("");
      expect(banner.style.display).toBe("");
    });
  });

  describe("updateAllSearchBanners", () => {
    it("updates document #aa-mpd-search-summary if best MPD > 0", () => {
      const banner = document.createElement("div");
      banner.id = "aa-mpd-search-summary";
      document.body.appendChild(banner);

      // Ingest a hotel so getCurrentPageBestMPD() returns a positive number
      clearHotelMpdRegistry();
      const bannerUpdateSpy = vi.fn();
      updateAllSearchBanners();
      expect(banner.innerHTML).toBe(""); // bestMPD is 0

      // Now add a hotel into registry
      const hotelRate = {
        hotelId: "h-test",
        hotelName: "Grand Hotel",
        price: 200,
        basePrice: 200,
        allInPrice: 250,
        baseMiles: 5000,
        tieredMiles: 7500,
      };
      ingestHotelRates([hotelRate as any], "status_cardmember", true);

      updateAllSearchBanners();
      expect(banner.innerHTML).toContain("Best earn rate for this location: <b>30.0 miles/$</b>");
      expect(banner.innerHTML).toContain("(considering 1 properties)");
    });
  });

  describe("runBackgroundSearchQueries", () => {
    const mockRequest: CapturedSearchRequest = {
      url: "https://www.aadvantagehotels.com/api/graphql",
      headers: { "x-custom": "test-header" },
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

    it("does not run queries when expandSearchResults is false", async () => {
      const fetchFn = vi.fn();
      const result = await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: false,
        fetchFn,
      });

      expect(result).toEqual({ queriedPages: 0, totalHotelsFound: 0 });
      expect(fetchFn).not.toHaveBeenCalled();
      expect(isBackgroundSearchLoading()).toBe(false);
    });

    it("does not run queries if body lacks searchRequest.page or maxSearchResults covers only the site's page", async () => {
      const fetchFn = vi.fn();
      const invalidRequest: CapturedSearchRequest = {
        url: "https://test.com",
        headers: {},
        body: { variables: {} },
      };

      const res1 = await runBackgroundSearchQueries(invalidRequest, {
        expandSearchResults: true,
        fetchFn,
      });
      expect(res1).toEqual({ queriedPages: 0, totalHotelsFound: 0 });

      const res2 = await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: true,
        maxSearchResults: 90,
        fetchFn,
      });
      expect(res2).toEqual({ queriedPages: 0, totalHotelsFound: 0 });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("queries subsequent pages up to maxSearchResults, passes headers, and ingests rates", async () => {
      const page2Hotels = [
        {
          hotel: { id: 101, name: "Page 2 Hotel" },
          economics: {
            total: { amount: 200 },
            rewardAmount: 3000,
            rewardAmountTiered: 6000,
          },
        },
      ];
      const page3Hotels = [
        {
          hotel: { id: 102, name: "Page 3 Hotel" },
          economics: {
            total: { amount: 100 },
            rewardAmount: 4000,
            rewardAmountTiered: 5000,
          },
        },
      ];

      const fetchFn = vi.fn().mockImplementation((url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        const pageNum = body.variables.CitySearchRequest.searchRequest.page.pageNumber;
        const hotels = pageNum === 2 ? page2Hotels : pageNum === 3 ? page3Hotels : [];
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              searchResult: {
                totalFilteredHotels: 2,
                results: hotels,
              },
            }),
        });
      });

      const pagesLoaded: number[] = [];
      const result = await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: true,
        maxSearchResults: 270,
        delayMs: 10,
        jitterMs: 0,
        fetchFn: fetchFn as any,
        onPageLoaded: (pageNum) => pagesLoaded.push(pageNum),
      });

      expect(result).toEqual({ queriedPages: 2, totalHotelsFound: 2 });
      expect(pagesLoaded).toEqual([2, 3]);
      expect(fetchFn).toHaveBeenCalledTimes(2);

      // Verify header inspection and pagination
      const firstCallInit = fetchFn.mock.calls[0][1];
      expect(firstCallInit.headers["x-custom"]).toBe("test-header");
      expect(firstCallInit.headers["x-aa-mpd-background"]).toBe("true");

      // Verify rates ingested into registry
      const hotel101 = getEnrichedHotel("101");
      expect(hotel101).toBeDefined();
      expect(hotel101?.hotelName).toBe("Page 2 Hotel");
      expect(getHotelMPD("101")).toBe(30);

      const hotel102 = getEnrichedHotel("102");
      expect(hotel102).toBeDefined();
      expect(hotel102?.hotelName).toBe("Page 3 Hotel");
      expect(getHotelMPD("102")).toBe(50);

      // Loading state cleared after run
      expect(isBackgroundSearchLoading()).toBe(false);
    });

    it("requests 90-hotel pages so background page 2 follows the site's first 90 hotels", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ searchResult: { totalFilteredHotels: 0, results: [] } }),
      });
      await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: true,
        maxSearchResults: 270,
        delayMs: 0,
        jitterMs: 0,
        fetchFn: fetchFn as any,
      });
      const page = JSON.parse(fetchFn.mock.calls[0][1].body).variables.CitySearchRequest.searchRequest.page;
      expect(page).toEqual({ pageSize: BACKGROUND_PAGE_SIZE, pageNumber: 2, pageToken: "" });
      expect(BACKGROUND_PAGE_SIZE).toBe(90);
    });

    it("stops once its pages cover the search's total", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            searchResult: {
              searchInfo: { totalFilteredHotels: 200 },
              results: [{ hotel: { id: 7, name: "Hotel" }, economics: { total: { amount: 100 }, rewardAmount: 1000 } }],
            },
          }),
      });
      await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: true,
        maxSearchResults: 900,
        delayMs: 0,
        jitterMs: 0,
        fetchFn: fetchFn as any,
      });
      // Pages 2 and 3 reach hotel 270, past the 200 the search reported; pages 4 to 10 are skipped
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("runs once per search, ignoring the site's re-requests until aborted", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ searchResult: { totalFilteredHotels: 0, results: [] } }),
      });
      const options = { expandSearchResults: true, maxSearchResults: 180, delayMs: 0, jitterMs: 0, fetchFn: fetchFn as any };
      // The site gives each page of one search its own searchId
      const sitePage = (pageNumber: number, searchId: string): CapturedSearchRequest => ({
        ...mockRequest,
        body: {
          operationName: "CitySearch",
          variables: {
            CitySearchRequest: {
              searchRequest: {
                page: { pageSize: 45, pageNumber, pageToken: "" },
                searchContext: { searchId },
              },
            },
          },
        },
      });
      const sitePage2 = sitePage(2, "page-2-id");

      await runBackgroundSearchQueries(sitePage(1, "page-1-id"), options);
      await runBackgroundSearchQueries(sitePage2, options);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      abortBackgroundSearchQueries();
      await runBackgroundSearchQueries(sitePage2, options);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("stops pagination early when a page returns 0 results", async () => {
      const fetchFn = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              searchResult: {
                totalFilteredHotels: 0,
                results: [],
              },
            }),
        })
      );

      const result = await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: true,
        maxSearchResults: 450,
        delayMs: 10,
        jitterMs: 0,
        fetchFn: fetchFn as any,
      });

      // Queried page 2, got 0 results, stopped before page 3..5
      expect(result).toEqual({ queriedPages: 1, totalHotelsFound: 0 });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(isBackgroundSearchLoading()).toBe(false);
    });

    it("stops pagination gracefully on HTTP error status", async () => {
      const fetchFn = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        })
      );

      const result = await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: true,
        maxSearchResults: 450,
        delayMs: 10,
        jitterMs: 0,
        fetchFn: fetchFn as any,
      });

      expect(result).toEqual({ queriedPages: 0, totalHotelsFound: 0 });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(isBackgroundSearchLoading()).toBe(false);
    });

    it("stops background query loop when abortBackgroundSearchQueries is called", async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Abort after first query
          abortBackgroundSearchQueries();
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              searchResult: {
                results: [
                  {
                    hotel: { id: 201, name: "Hotel 201" },
                    economics: { total: { amount: 100 }, rewardAmount: 1000 },
                  },
                ],
              },
            }),
        });
      });

      const result = await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: true,
        maxSearchResults: 450,
        delayMs: 15,
        jitterMs: 0,
        fetchFn: fetchFn as any,
      });

      // Should have aborted before completing page 3..5
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(isBackgroundSearchLoading()).toBe(false);
    });

    it("toggles logo spinning and updates banner during query execution", async () => {
      const banner = document.createElement("div");
      banner.id = "aa-mpd-search-summary";
      document.body.appendChild(banner);

      // Seed initial hotel from page 1 so banner displays best MPD and shows spinning logo
      ingestHotelRates([
        {
          hotelId: "300",
          hotelName: "Hotel 300",
          price: 100,
          basePrice: 100,
          allInPrice: 100,
          baseMiles: 1000,
          tieredMiles: 1500,
        } as any,
      ]);

      let loadingObserved = false;
      const fetchFn = vi.fn().mockImplementation(async () => {
        if (isBackgroundSearchLoading() && banner.innerHTML.includes("aa-mpd-spinning")) {
          loadingObserved = true;
        }
        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              searchResult: {
                results: [
                  {
                    hotel: { id: 301, name: "Hotel 301" },
                    economics: { total: { amount: 100 }, rewardAmount: 2000 },
                  },
                ],
              },
            }),
        };
      });

      await runBackgroundSearchQueries(mockRequest, {
        expandSearchResults: true,
        maxSearchResults: 180,
        delayMs: 10,
        jitterMs: 0,
        fetchFn: fetchFn as any,
      });

      expect(loadingObserved).toBe(true);
      // Once finished, loading state is reset
      expect(isBackgroundSearchLoading()).toBe(false);
      expect(banner.innerHTML).not.toContain("aa-mpd-spinning");
      expect(banner.innerHTML).toContain("There may be better deals on additional pages.");
    });
  });
});
