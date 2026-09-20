import { describe, it, expect } from "vitest";
import { exportQueriesToCsv } from "../src/export/csv";
import { exportQueriesToSql } from "../src/export/sql";
import { ExhaustiveQueryRecord } from "../src/types";

describe("Export Utilities (CSV & SQL)", () => {
  const sampleQueries: ExhaustiveQueryRecord[] = [
    {
      id: 1,
      queryTimestamp: "2026-10-05T14:30:00.000Z",
      location: "Dallas, TX, USA",
      checkIn: "2026-10-05",
      checkOut: "2026-10-07",
      nights: 2,
      rooms: 1,
      guests: 2,
      pageUrl: "https://www.aadvantagehotels.com/search?destination=Dallas",
      rates: [
        {
          hotelName: "Hilton Anatole, Dallas",
          hotelId: "2687",
          price: 496,
          miles: 6000,
          mpd: 12.1,
          isTotalPrice: true,
          isBonus: false,
        },
        {
          hotelName: 'The "Grand" Plaza',
          hotelId: "9999",
          price: 250,
          miles: 5000,
          mpd: 20.0,
          isTotalPrice: true,
          isBonus: true,
        },
      ],
    },
    {
      id: 2,
      queryTimestamp: "2026-10-06T09:00:00.000Z",
      location: "Chicago, IL, USA",
      checkIn: "2026-10-10",
      checkOut: "2026-10-11",
      nights: 1,
      rooms: 1,
      guests: 1,
      pageUrl: "https://www.aadvantagehotels.com/search?destination=Chicago",
      rates: [],
    },
  ];

  describe("CSV Export", () => {
    it("generates correct CSV headers and escapes special characters", () => {
      const csv = exportQueriesToCsv(sampleQueries);

      const lines = csv.split("\r\n");
      expect(lines[0]).toBe(
        "Query Timestamp,Location,Check-In,Check-Out,Nights,Rooms,Guests,Hotel Name,Hotel ID,Price ($),Miles Earned,MPD,Pricing Type,Bonus Tag"
      );

      // Line 1: Hilton Anatole with comma in hotel name
      expect(lines[1]).toContain('"Hilton Anatole, Dallas"');
      expect(lines[1]).toContain('"Dallas, TX, USA"');
      expect(lines[1]).toContain("496,6000,12.1,Total,No");

      // Line 2: The "Grand" Plaza with quotes in hotel name
      expect(lines[2]).toContain('"The ""Grand"" Plaza"');
      expect(lines[2]).toContain("250,5000,20,Total,Yes");

      // Line 3: Query with no rates
      expect(lines[3]).toContain('"Chicago, IL, USA"');
      expect(lines[3]).toContain("2026-10-10");
    });
  });

  describe("SQL Export", () => {
    it("generates valid DDL and escaped INSERT statements", () => {
      const sql = exportQueriesToSql(sampleQueries);

      expect(sql).toContain("CREATE TABLE IF NOT EXISTS aa_queries");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS aa_rates");
      expect(sql).toContain("BEGIN TRANSACTION;");
      expect(sql).toContain("COMMIT;");

      // Verify query insert
      expect(sql).toContain(
        "INSERT INTO aa_queries (id, query_timestamp, location, check_in, check_out, nights, rooms, guests, page_url) VALUES (1, '2026-10-05T14:30:00.000Z', 'Dallas, TX, USA', '2026-10-05', '2026-10-07', 2, 1, 2, 'https://www.aadvantagehotels.com/search?destination=Dallas');"
      );

      // Verify rate inserts
      expect(sql).toContain(
        "INSERT INTO aa_rates (query_id, hotel_name, hotel_id, price, miles, mpd, is_total_price, is_bonus) VALUES (1, 'Hilton Anatole, Dallas', '2687', 496, 6000, 12.1, 1, 0);"
      );
      expect(sql).toContain(
        "INSERT INTO aa_rates (query_id, hotel_name, hotel_id, price, miles, mpd, is_total_price, is_bonus) VALUES (1, 'The \"Grand\" Plaza', '9999', 250, 5000, 20, 1, 1);"
      );
    });

    it("escapes single quotes in SQL strings correctly", () => {
      const queriesWithQuotes: ExhaustiveQueryRecord[] = [
        {
          id: 10,
          queryTimestamp: "2026-10-05T14:30:00.000Z",
          location: "O'Hare, Chicago",
          checkIn: "2026-10-05",
          checkOut: "2026-10-07",
          nights: 2,
          rooms: 1,
          guests: 1,
          pageUrl: "https://www.aadvantagehotels.com/search?destination=O'Hare",
          rates: [
            {
              hotelName: "St. John's Boutique Hotel",
              price: 150,
              miles: 3000,
              mpd: 20.0,
              isTotalPrice: true,
              isBonus: false,
            },
          ],
        },
      ];

      const sql = exportQueriesToSql(queriesWithQuotes);
      expect(sql).toContain("'O''Hare, Chicago'");
      expect(sql).toContain("'St. John''s Boutique Hotel'");
      expect(sql).not.toContain("'O'Hare");
    });
  });
});
