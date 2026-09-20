import { ExhaustiveQueryRecord } from "../types";

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportQueriesToCsv(queries: ExhaustiveQueryRecord[]): string {
  const headers = [
    "Query Timestamp",
    "Location",
    "Check-In",
    "Check-Out",
    "Nights",
    "Rooms",
    "Guests",
    "Hotel Name",
    "Hotel ID",
    "Price ($)",
    "Miles Earned",
    "MPD",
    "Pricing Type",
    "Bonus Tag",
  ];

  const rows: string[] = [headers.join(",")];

  for (const query of queries) {
    if (!query.rates || query.rates.length === 0) {
      rows.push(
        [
          escapeCsvField(query.queryTimestamp),
          escapeCsvField(query.location),
          escapeCsvField(query.checkIn),
          escapeCsvField(query.checkOut),
          escapeCsvField(query.nights),
          escapeCsvField(query.rooms),
          escapeCsvField(query.guests),
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ].join(",")
      );
      continue;
    }

    for (const rate of query.rates) {
      rows.push(
        [
          escapeCsvField(query.queryTimestamp),
          escapeCsvField(query.location),
          escapeCsvField(query.checkIn),
          escapeCsvField(query.checkOut),
          escapeCsvField(query.nights),
          escapeCsvField(query.rooms),
          escapeCsvField(query.guests),
          escapeCsvField(rate.hotelName),
          escapeCsvField(rate.hotelId || ""),
          escapeCsvField(rate.price),
          escapeCsvField(rate.miles),
          escapeCsvField(rate.mpd),
          escapeCsvField(rate.isTotalPrice ? "Total" : "Per Night"),
          escapeCsvField(rate.isBonus ? "Yes" : "No"),
        ].join(",")
      );
    }
  }

  return rows.join("\r\n");
}
