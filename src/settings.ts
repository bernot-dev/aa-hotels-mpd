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
