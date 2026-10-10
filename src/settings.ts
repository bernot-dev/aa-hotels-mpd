// User settings that affect how miles per dollar is calculated

/**
 * Which AAdvantage earning level's base miles to calculate with. Hotels show base miles for
 * "AAdvantage® member" and a higher amount for "AAdvantage® credit cardmembers with status"; both
 * count toward Loyalty Points. Promotional bonus miles are a separate setting (includeBonusMiles).
 */
export type EarningLevel = "status_cardmember" | "member";

export const DEFAULT_EARNING_LEVEL: EarningLevel = "status_cardmember";

export interface PricingSettings {
  earningLevel: EarningLevel;
  includeBonusMiles: boolean;
  useAllInPricing: boolean;
}

export function parseEarningLevel(value: unknown): EarningLevel {
  return value === "member" ? "member" : DEFAULT_EARNING_LEVEL;
}

/**
 * Picks the base miles for the earning level. memberMiles is the "AAdvantage member" amount and
 * statusMiles the "credit cardmembers with status" amount; either may be 0 when not offered.
 */
export function milesForEarningLevel(memberMiles: number, statusMiles: number, level: EarningLevel): number {
  return level === "member" ? memberMiles || statusMiles : statusMiles || memberMiles;
}

export async function loadPricingSettings(): Promise<PricingSettings> {
  const settings: PricingSettings = {
    earningLevel: DEFAULT_EARNING_LEVEL,
    includeBonusMiles: false,
    useAllInPricing: true,
  };
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get([
        "earningLevel",
        "includeBonusMiles",
        "pricingCalculationMethod",
        "useAllInPricing",
      ]);
      settings.earningLevel = parseEarningLevel(result.earningLevel);
      settings.includeBonusMiles = Boolean(result.includeBonusMiles);
      if (result.pricingCalculationMethod) {
        settings.useAllInPricing = result.pricingCalculationMethod === "all_in";
      } else if (typeof result.useAllInPricing === "boolean") {
        settings.useAllInPricing = result.useAllInPricing;
      }
    }
  } catch {
    // Ignore storage read errors and use defaults
  }
  return settings;
}

/**
 * Hotels per background search page. The API allows up to 100; 90 lines its pages up with the two
 * 45-hotel pages the site loads itself, so background page 2 starts at the site's hotel 91.
 */
export const BACKGROUND_PAGE_SIZE = 90;
export const DEFAULT_MAX_SEARCH_RESULTS = 450;
export const MAX_SEARCH_RESULTS_LIMIT = 4500;
// Hotels per page back when the setting was a number of pages (maxSearchPages)
const LEGACY_HOTELS_PER_PAGE = 45;

/** Rounds down to whole background pages, from the 90 hotels the site shows itself up to the limit. */
export function clampMaxSearchResults(value: number): number {
  const pages = Math.floor(value / BACKGROUND_PAGE_SIZE);
  return Math.max(1, Math.min(MAX_SEARCH_RESULTS_LIMIT / BACKGROUND_PAGE_SIZE, pages)) * BACKGROUND_PAGE_SIZE;
}

/** The stored maximum number of results, converting a page count saved by older versions. */
export function readMaxSearchResults(stored: { maxSearchResults?: unknown; maxSearchPages?: unknown }): number {
  if (typeof stored.maxSearchResults === "number" && stored.maxSearchResults > 0) {
    return clampMaxSearchResults(stored.maxSearchResults);
  }
  if (typeof stored.maxSearchPages === "number" && stored.maxSearchPages > 0) {
    return clampMaxSearchResults(stored.maxSearchPages * LEGACY_HOTELS_PER_PAGE);
  }
  return DEFAULT_MAX_SEARCH_RESULTS;
}

export interface SearchSettings {
  expandSearchResults: boolean;
  /** Most hotels to consider per search: the site's own pages plus background pages. */
  maxSearchResults: number;
}

export async function loadSearchSettings(): Promise<SearchSettings> {
  const settings: SearchSettings = {
    expandSearchResults: true,
    maxSearchResults: DEFAULT_MAX_SEARCH_RESULTS,
  };
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get([
        "expandSearchResults",
        "maxSearchResults",
        "maxSearchPages",
      ]);
      if (typeof result.expandSearchResults === "boolean") {
        settings.expandSearchResults = result.expandSearchResults;
      }
      settings.maxSearchResults = readMaxSearchResults(result);
    }
  } catch {
    // Ignore storage read errors and use defaults
  }
  return settings;
}
