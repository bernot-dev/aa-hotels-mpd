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
  price: number;
  miles: number;
  mpd: number;
  isTotalPrice: boolean;
  isBonus: boolean;
  roomType?: string;
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
  miles: number;
  timestamp: string;
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

export interface DashboardStats {
  topMpds: TopMpdRecord[];
  topLocations: LocationStatRecord[];
  lowestLocations: LocationStatRecord[];
  allLocations: LocationStatRecord[];
  nightsStats: Record<number, NightStatRecord>;
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
