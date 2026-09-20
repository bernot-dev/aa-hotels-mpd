import { TopMpdRecord, ChainStat, SeasonalityStats, SeasonalityBucket, DayOfWeekStat } from "./types";

const CHAIN_PATTERNS: { chain: string; regex: RegExp }[] = [
  {
    chain: "Marriott",
    regex: /\b(marriott|courtyard|fairfield|residence inn|springhill|towneplace|sheraton|westin|renaissance|aloft|element|moxy|ritz-carlton|jw marriott|ac hotel|delta hotel|four points|autograph collection|st\.? regis|w hotel|le meridien|gaylord)\b/i,
  },
  {
    chain: "Hilton",
    regex: /\b(hilton|hampton|doubletree|embassy suites|homewood|home2|hilton garden|tru by hilton|curio|canopy|waldorf|conrad|tapestry|motto|signia)\b/i,
  },
  {
    chain: "IHG",
    regex: /\b(holiday inn|crowne plaza|intercontinental|kimpton|indigo|candlewood|staybridge|avid|voco|even hotel)\b/i,
  },
  {
    chain: "Wyndham",
    regex: /\b(wyndham|ramada|days inn|super 8|baymont|la quinta|microtel|wingate|americinn|hawthorn|trademark|howard johnson|travelodge|dolce)\b/i,
  },
  {
    chain: "Hyatt",
    regex: /\b(hyatt|hyatt place|hyatt house|hyatt regency|grand hyatt|andaz|thompson|alila|park hyatt|centric)\b/i,
  },
  {
    chain: "Choice",
    regex: /\b(choice|comfort inn|comfort suites|quality inn|sleep inn|clarion|mainstay|suburban|rodeway|econo lodge|cambria|ascend)\b/i,
  },
  {
    chain: "Best Western",
    regex: /\b(best western|surestay|worldhotels|aiden|glo)\b/i,
  },
  {
    chain: "Sonesta",
    regex: /\b(sonesta|sonesta simply|sonesta select|sonesta es)\b/i,
  },
  {
    chain: "Radisson",
    regex: /\b(radisson|country inn|park inn)\b/i,
  },
];

export function identifyHotelChain(hotelName: string): string {
  if (!hotelName) return "Independent / Other";
  for (const { chain, regex } of CHAIN_PATTERNS) {
    if (regex.test(hotelName)) {
      return chain;
    }
  }
  return "Independent / Other";
}

export function computeValueScore(mpd: number, rating?: number): number {
  if (mpd <= 0) return 0;
  // If guest rating is available (0..10), scale by rating / 10; otherwise default to baseline 0.75
  const normalizedRating = typeof rating === "number" && rating > 0 ? Math.min(10, rating) / 10 : 0.75;
  return Number((mpd * normalizedRating).toFixed(1));
}

export function computeCpm(price: number, miles: number): number {
  if (price <= 0 || miles <= 0) return 0;
  return Number(((price / miles) * 100).toFixed(1));
}

export function computeChainStats(records: TopMpdRecord[]): ChainStat[] {
  const chainMap = new Map<
    string,
    {
      count: number;
      totalMpd: number;
      bestMpd: number;
      totalCpm: number;
      cpmCount: number;
      topHotel: string;
    }
  >();

  for (const record of records) {
    const chain = record.chain || identifyHotelChain(record.hotelName);
    const existing = chainMap.get(chain) || {
      count: 0,
      totalMpd: 0,
      bestMpd: 0,
      totalCpm: 0,
      cpmCount: 0,
      topHotel: record.hotelName,
    };

    existing.count++;
    existing.totalMpd += record.mpd;
    if (record.mpd > existing.bestMpd) {
      existing.bestMpd = record.mpd;
      existing.topHotel = record.hotelName;
    }

    const cpm = record.cpm || computeCpm(record.price, record.miles);
    if (cpm > 0) {
      existing.totalCpm += cpm;
      existing.cpmCount++;
    }

    chainMap.set(chain, existing);
  }

  const result: ChainStat[] = [];
  chainMap.forEach((val, chain) => {
    result.push({
      chain,
      count: val.count,
      avgMpd: Number((val.totalMpd / val.count).toFixed(1)),
      bestMpd: Number(val.bestMpd.toFixed(1)),
      avgCpm: val.cpmCount > 0 ? Number((val.totalCpm / val.cpmCount).toFixed(1)) : 0,
      topHotel: val.topHotel,
    });
  });

  // Sort by highest average MPD descending
  return result.sort((a, b) => b.avgMpd - a.avgMpd);
}

const BUCKET_DEFS = [
  { label: "Last Minute (0–3d)", min: 0, max: 3 },
  { label: "Short Term (4–7d)", min: 4, max: 7 },
  { label: "2 Weeks (8–14d)", min: 8, max: 14 },
  { label: "1 Month (15–30d)", min: 15, max: 30 },
  { label: "2 Months (31–60d)", min: 31, max: 60 },
  { label: "Advance (60d+)", min: 61, max: 9999 },
];

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function computeSeasonalityStats(records: TopMpdRecord[]): SeasonalityStats {
  const bucketCounts = BUCKET_DEFS.map((b) => ({ ...b, count: 0, totalMpd: 0 }));
  const days = DAY_NAMES.map((dayName, dayIndex) => ({
    dayName,
    dayIndex,
    count: 0,
    totalMpd: 0,
  }));

  let weekdayTotalMpd = 0;
  let weekdayCount = 0;
  let weekendTotalMpd = 0;
  let weekendCount = 0;

  for (const record of records) {
    if (!record.checkIn || !record.timestamp) continue;

    const checkInMs = new Date(record.checkIn + "T12:00:00Z").getTime();
    const createdMs = new Date(record.timestamp).getTime();

    if (!isNaN(checkInMs) && !isNaN(createdMs)) {
      const daysInAdvance = Math.max(
        0,
        Math.round((checkInMs - createdMs) / (1000 * 60 * 60 * 24))
      );

      for (const b of bucketCounts) {
        if (daysInAdvance >= b.min && daysInAdvance <= b.max) {
          b.count++;
          b.totalMpd += record.mpd;
          break;
        }
      }

      const dayIdx = new Date(record.checkIn + "T12:00:00Z").getUTCDay();
      if (dayIdx >= 0 && dayIdx <= 6) {
        days[dayIdx].count++;
        days[dayIdx].totalMpd += record.mpd;

        // Weekday: Sun(0)..Thu(4) check-in
        // Weekend: Fri(5)..Sat(6) check-in
        if (dayIdx >= 0 && dayIdx <= 4) {
          weekdayTotalMpd += record.mpd;
          weekdayCount++;
        } else {
          weekendTotalMpd += record.mpd;
          weekendCount++;
        }
      }
    }
  }

  const bookingWindows: SeasonalityBucket[] = bucketCounts.map((b) => ({
    label: b.label,
    count: b.count,
    avgMpd: b.count > 0 ? Number((b.totalMpd / b.count).toFixed(1)) : 0,
  }));

  const dayOfWeek: DayOfWeekStat[] = days.map((d) => ({
    dayName: d.dayName,
    dayIndex: d.dayIndex,
    count: d.count,
    avgMpd: d.count > 0 ? Number((d.totalMpd / d.count).toFixed(1)) : 0,
  }));

  return {
    bookingWindows,
    dayOfWeek,
    weekdayAvgMpd: weekdayCount > 0 ? Number((weekdayTotalMpd / weekdayCount).toFixed(1)) : 0,
    weekendAvgMpd: weekendCount > 0 ? Number((weekendTotalMpd / weekendCount).toFixed(1)) : 0,
  };
}

/**
 * Deduplicates top MPD records so each unique hotel is featured at most once.
 * Retains the first (best-ranked under current sorting) record for each hotel.
 */
export function deduplicateRecordsByHotel(records: TopMpdRecord[]): TopMpdRecord[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const deduplicated: TopMpdRecord[] = [];

  for (const r of records) {
    const id = r.hotelId ? String(r.hotelId).trim() : "";
    const name = (r.hotelName || "").trim().toLowerCase();

    if (id && seenIds.has(id)) {
      continue;
    }
    if (name && seenNames.has(name)) {
      continue;
    }

    if (id) seenIds.add(id);
    if (name) seenNames.add(name);
    deduplicated.push(r);
  }

  return deduplicated;
}

export interface LocationHierarchyCity {
  cityLocation: string; // e.g. "Corvallis, OR"
  cityName: string; // e.g. "Corvallis"
  count: number;
}

export interface LocationHierarchyState {
  stateKey: string; // e.g. "OR"
  stateName: string; // e.g. "Oregon"
  displayLabel: string; // e.g. "Oregon (OR)"
  totalDeals: number;
  cities: LocationHierarchyCity[];
}

export interface LocationHierarchyCountry {
  countryKey: string; // e.g. "United States"
  countryName: string; // e.g. "United States"
  displayLabel: string; // e.g. "United States"
  totalDeals: number;
  states: LocationHierarchyState[];
}

export const US_STATE_CODE_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming", DC: "District of Columbia",
};

export const CA_PROVINCES_MAP: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
  NL: "Newfoundland and Labrador", NS: "Nova Scotia", ON: "Ontario",
  PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan",
  NT: "Northwest Territories", NU: "Nunavut", YT: "Yukon",
};

export function normalizeCountryName(countryRaw?: string): string {
  if (!countryRaw) return "";
  const trimmed = countryRaw.trim();
  if (/^(?:US|USA|United States|United States of America)$/i.test(trimmed)) {
    return "United States";
  }
  if (/^(?:UK|GB|Great Britain|United Kingdom)$/i.test(trimmed)) {
    return "United Kingdom";
  }
  if (/^(?:CA|CAN|Canada)$/i.test(trimmed)) {
    return "Canada";
  }
  if (/^(?:MX|MEX|Mexico)$/i.test(trimmed)) {
    return "Mexico";
  }
  return trimmed;
}

export function parseLocationHierarchy(
  location: string,
  explicitCountry?: string
): {
  countryName: string;
  stateKey: string;
  stateName: string;
  stateDisplayLabel: string;
  cityName: string;
} {
  const normCountry = normalizeCountryName(explicitCountry);
  const parts = location.split(",").map((s) => s.trim());
  const cityName = parts[0] || location;

  if (parts.length >= 3) {
    // e.g. "Toronto, ON, Canada" or "Dallas, TX, US"
    const lastPart = parts[parts.length - 1];
    const midPart = parts[1].toUpperCase();
    const countryName = normCountry || normalizeCountryName(lastPart);

    if (US_STATE_CODE_TO_NAME[midPart]) {
      return {
        countryName: countryName || "United States",
        stateKey: midPart,
        stateName: US_STATE_CODE_TO_NAME[midPart],
        stateDisplayLabel: `${US_STATE_CODE_TO_NAME[midPart]} (${midPart})`,
        cityName,
      };
    }
    if (CA_PROVINCES_MAP[midPart]) {
      return {
        countryName: countryName || "Canada",
        stateKey: midPart,
        stateName: CA_PROVINCES_MAP[midPart],
        stateDisplayLabel: `${CA_PROVINCES_MAP[midPart]} (${midPart})`,
        cityName,
      };
    }
    return {
      countryName: countryName || "Other",
      stateKey: parts[1],
      stateName: parts[1],
      stateDisplayLabel: parts[1],
      cityName,
    };
  }

  if (parts.length === 2) {
    // e.g. "Corvallis, OR" or "Dallas, TX" or "Paris, France" or "London, United Kingdom"
    const second = parts[1].toUpperCase();
    if (US_STATE_CODE_TO_NAME[second]) {
      return {
        countryName: normCountry || "United States",
        stateKey: second,
        stateName: US_STATE_CODE_TO_NAME[second],
        stateDisplayLabel: `${US_STATE_CODE_TO_NAME[second]} (${second})`,
        cityName,
      };
    }
    if (CA_PROVINCES_MAP[second]) {
      return {
        countryName: normCountry || "Canada",
        stateKey: second,
        stateName: CA_PROVINCES_MAP[second],
        stateDisplayLabel: `${CA_PROVINCES_MAP[second]} (${second})`,
        cityName,
      };
    }
    const country = normCountry || normalizeCountryName(parts[1]);
    return {
      countryName: country || "Other",
      stateKey: parts[1],
      stateName: parts[1],
      stateDisplayLabel: parts[1],
      cityName,
    };
  }

  return {
    countryName: normCountry || "Other",
    stateKey: "Other",
    stateName: "Other",
    stateDisplayLabel: "Other Locations",
    cityName,
  };
}

/**
 * Builds a 3-level hierarchical location tree (Country -> State -> Cities) from records.
 * Enables selecting a whole Country (e.g. United States) or State (e.g. Oregon) to select all child cities.
 */
export function buildLocationHierarchy(records: TopMpdRecord[]): LocationHierarchyCountry[] {
  const countryMap = new Map<
    string,
    {
      countryKey: string;
      countryName: string;
      displayLabel: string;
      stateMap: Map<
        string,
        {
          stateKey: string;
          stateName: string;
          displayLabel: string;
          cityCounts: Map<string, { cityName: string; count: number }>;
        }
      >;
    }
  >();

  for (const r of records) {
    const rawLoc = (r.location || "").trim();
    if (!rawLoc || rawLoc.toLowerCase() === "unknown location") continue;

    const parsed = parseLocationHierarchy(rawLoc, r.country);
    const countryKey = parsed.countryName;

    let countryEntry = countryMap.get(countryKey);
    if (!countryEntry) {
      countryEntry = {
        countryKey,
        countryName: parsed.countryName,
        displayLabel: parsed.countryName,
        stateMap: new Map(),
      };
      countryMap.set(countryKey, countryEntry);
    }

    let stateEntry = countryEntry.stateMap.get(parsed.stateKey);
    if (!stateEntry) {
      stateEntry = {
        stateKey: parsed.stateKey,
        stateName: parsed.stateName,
        displayLabel: parsed.stateDisplayLabel,
        cityCounts: new Map(),
      };
      countryEntry.stateMap.set(parsed.stateKey, stateEntry);
    }

    const cityEntry = stateEntry.cityCounts.get(rawLoc) || { cityName: parsed.cityName, count: 0 };
    cityEntry.count++;
    stateEntry.cityCounts.set(rawLoc, cityEntry);
  }

  const result: LocationHierarchyCountry[] = [];
  countryMap.forEach((cEntry) => {
    const states: LocationHierarchyState[] = [];
    cEntry.stateMap.forEach((sEntry) => {
      const cities: LocationHierarchyCity[] = Array.from(sEntry.cityCounts.entries())
        .map(([cityLocation, { cityName, count }]) => ({
          cityLocation,
          cityName,
          count,
        }))
        .sort((a, b) => a.cityName.localeCompare(b.cityName));

      const totalDeals = cities.reduce((sum, c) => sum + c.count, 0);
      states.push({
        stateKey: sEntry.stateKey,
        stateName: sEntry.stateName,
        displayLabel: sEntry.displayLabel,
        totalDeals,
        cities,
      });
    });

    states.sort((a, b) => a.stateName.localeCompare(b.stateName));
    const totalCountryDeals = states.reduce((sum, s) => sum + s.totalDeals, 0);

    result.push({
      countryKey: cEntry.countryKey,
      countryName: cEntry.countryName,
      displayLabel: cEntry.displayLabel,
      totalDeals: totalCountryDeals,
      states,
    });
  });

  return result.sort((a, b) => {
    if (a.countryName === "United States") return -1;
    if (b.countryName === "United States") return 1;
    return a.countryName.localeCompare(b.countryName);
  });
}

