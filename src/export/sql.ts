import { ExhaustiveQueryRecord } from "../types";

function escapeSqlString(str: string | null | undefined): string {
  if (str === null || str === undefined) {
    return "NULL";
  }
  return `'${String(str).replace(/'/g, "''")}'`;
}

export function exportQueriesToSql(queries: ExhaustiveQueryRecord[]): string {
  const lines: string[] = [
    "-- AA Hotels MPD Query History Dump",
    `-- Exported at: ${new Date().toISOString()}`,
    "",
    "CREATE TABLE IF NOT EXISTS aa_queries (",
    "    id INTEGER PRIMARY KEY,",
    "    query_timestamp TEXT NOT NULL,",
    "    location TEXT NOT NULL,",
    "    check_in TEXT NOT NULL,",
    "    check_out TEXT NOT NULL,",
    "    nights INTEGER NOT NULL,",
    "    rooms INTEGER NOT NULL,",
    "    guests INTEGER NOT NULL,",
    "    page_url TEXT",
    ");",
    "",
    "CREATE TABLE IF NOT EXISTS aa_rates (",
    "    id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "    query_id INTEGER,",
    "    hotel_name TEXT NOT NULL,",
    "    hotel_id TEXT,",
    "    price REAL NOT NULL,",
    "    miles INTEGER NOT NULL,",
    "    mpd REAL NOT NULL,",
    "    is_total_price INTEGER NOT NULL,",
    "    is_bonus INTEGER NOT NULL,",
    "    FOREIGN KEY(query_id) REFERENCES aa_queries(id)",
    ");",
    "",
    "BEGIN TRANSACTION;",
    "",
  ];

  let queryIndex = 1;
  for (const query of queries) {
    const qId = query.id || queryIndex;
    lines.push(
      `INSERT INTO aa_queries (id, query_timestamp, location, check_in, check_out, nights, rooms, guests, page_url) VALUES (` +
        `${qId}, ` +
        `${escapeSqlString(query.queryTimestamp)}, ` +
        `${escapeSqlString(query.location)}, ` +
        `${escapeSqlString(query.checkIn)}, ` +
        `${escapeSqlString(query.checkOut)}, ` +
        `${query.nights || 1}, ` +
        `${query.rooms || 1}, ` +
        `${query.guests || 1}, ` +
        `${escapeSqlString(query.pageUrl)}` +
        `);`
    );

    if (query.rates && query.rates.length > 0) {
      for (const rate of query.rates) {
        lines.push(
          `INSERT INTO aa_rates (query_id, hotel_name, hotel_id, price, miles, mpd, is_total_price, is_bonus) VALUES (` +
            `${qId}, ` +
            `${escapeSqlString(rate.hotelName)}, ` +
            `${rate.hotelId ? escapeSqlString(rate.hotelId) : "NULL"}, ` +
            `${rate.price || 0}, ` +
            `${rate.miles || 0}, ` +
            `${rate.mpd || 0}, ` +
            `${rate.isTotalPrice ? 1 : 0}, ` +
            `${rate.isBonus ? 1 : 0}` +
            `);`
        );
      }
    }

    queryIndex++;
  }

  lines.push("");
  lines.push("COMMIT;");
  lines.push("");

  return lines.join("\n");
}
