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
