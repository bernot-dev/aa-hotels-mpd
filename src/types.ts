// Common data structures for AA Hotels MPD Rate Tracking and Dashboard

export interface SearchCriteria {
  location: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  guests: number;
  timestamp: string;
  url: string;
}

export interface CapturedRate {
  hotelName: string;
  hotelId?: string;
  location?: string;
  price: number;
  basePrice?: number;
  allInPrice?: number;
  miles: number;
  mpd: number;
  isTotalPrice: boolean;
  isBonus: boolean;
  roomType?: string;
  stars?: number;
  rating?: number;
  reviewCount?: number;
  imageUrl?: string;
  refundable?: boolean;
  chain?: string;
  checkIn?: string;
  checkOut?: string;
}

export interface TopMpdRecord {
  id: string;
  mpd: number;
  hotelName: string;
  hotelId?: string;
  location: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  guests: number;
  price: number;
  basePrice?: number;
  allInPrice?: number;
  miles: number;
  timestamp: string;
  stars?: number;
  rating?: number;
  reviewCount?: number;
  imageUrl?: string;
  refundable?: boolean;
  chain?: string;
  cpm?: number; // Cents per mile
  valueScore?: number; // mpd * (rating / 10)
}

export interface LocationStatRecord {
  location: string; // Primary key (normalized lowercase or canonical)
  topMpd: number;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  price: number;
  miles: number;
  timestamp: string;
  observationCount: number;
  stars?: number;
  rating?: number;
  imageUrl?: string;
  cpm?: number;
}

export interface NightStatRecord {
  nights: number; // Primary key (1, 2, 3, ...)
  topMpd: number;
  hotelName: string;
  location: string;
  checkIn: string;
  checkOut: string;
  price: number;
  miles: number;
  timestamp: string;
  stars?: number;
  rating?: number;
  imageUrl?: string;
  cpm?: number;
}

export interface ExhaustiveQueryRecord {
  id?: number; // Auto-increment primary key
  queryTimestamp: string;
  location: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  guests: number;
  pageUrl: string;
  rates: CapturedRate[];
}

export interface ChainStat {
  chain: string;
  count: number;
  avgMpd: number;
  bestMpd: number;
  avgCpm: number;
  topHotel: string;
}

export interface SeasonalityBucket {
  label: string;
  count: number;
  avgMpd: number;
}

export interface DayOfWeekStat {
  dayName: string;
  dayIndex: number;
  count: number;
  avgMpd: number;
}

export interface SeasonalityStats {
  bookingWindows: SeasonalityBucket[];
  dayOfWeek: DayOfWeekStat[];
  weekdayAvgMpd: number;
  weekendAvgMpd: number;
}

export interface DashboardStats {
  topMpds: TopMpdRecord[];
  topLocations: LocationStatRecord[];
  lowestLocations: LocationStatRecord[];
  allLocations: LocationStatRecord[];
  nightsStats: Record<number, NightStatRecord>;
  chainStats?: ChainStat[];
  seasonality?: SeasonalityStats;
  totalQueries?: number;
  storageEstimate?: {
    queryCount: number;
    bytes: number;
    humanized: string;
  };
}

export interface ExtensionConfig {
  expandRoomRates: boolean;
  expandRoomTypes: boolean;
  includeBonusMiles: boolean;
  showDebugButton: boolean;
  keepExhaustiveQueryHistory: boolean;
}
