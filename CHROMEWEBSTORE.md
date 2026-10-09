# Chrome Web Store Listing — AA Hotels MPD

> Last Updated: 2026-10-09

## Store Listing

**Extension Name**
AA Hotels MPD

**Short Description**
Find the best miles per dollar on the new AAdvantage Hotels site. Shows earn rates, CPM, price ratings, and adds MPD sorting.

**Detailed Description**
Maximize your American Airlines AAdvantage® miles and Loyalty Points on every hotel stay!

AA Hotels MPD has been completely rebuilt for the new AAdvantage Hotels booking platform at search.aadvantagehotels.com. It automatically calculates and displays the Miles Per Dollar (MPD) and Cents Per Mile (CPM) for every hotel result and room rate, helping you quickly identify the best earning opportunities.

Key features:
- **Instant Miles Per Dollar (MPD):** See exactly how many miles you earn per dollar spent directly on every hotel card, map pin, and room rate.
- **Acquisition Cost (CPM):** Displays your cost per mile in cents, helping you evaluate whether paying extra for a room is a good mileage purchase.
- **Quick-Scan Value Colors:** Color-coded indicators show how a hotel's earn rate compares to others in your search (🟢 High earn rate, 🟡 Average, 🔴 Low).
- **Relative Price Guide:** 💲 to 💲💲💲 ratings show where each hotel sits within your current search budget.
- **Destination Top Earn Rate Banner:** A banner at the top shows the highest earn rate found across your search location.
- **Background Search Discovery:** Automatically checks additional pages of search results in the background so you can find top-earning properties without clicking through page after page.
- **Sort by Miles Per Dollar:** Re-adds a "Most miles per dollar" option directly into the site's sort menu to rank hotels by earn rate, highest first.
- **Status Tier Support:** Choose between general AAdvantage® Member and AAdvantage® Credit Cardmember with Status rates so calculations match what you actually earn toward status.
- **All-In Pricing:** Calculates rates using total prices including taxes and fees so you know your true return.
- **Completely Private and Local:** Runs 100% in your browser. No accounts, no analytics, no ads, and no data is ever collected or transmitted.

How to use:
1. Navigate to search.aadvantagehotels.com and search for any destination.
2. The extension automatically calculates and displays earn rates and value ratings on hotel cards and pins.
3. Use the "Most miles per dollar" option in the sort bar to sort results by earn rate.
4. Click any hotel to view room-by-room earn rates on the room selection page.

**Category**
Search Tools

**Single Purpose**
Calculates and displays estimated miles earned per dollar on AAdvantage Hotels booking pages.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | images/icon-128.png |
| Screenshot 1 (Search) | 1280×800 | ✅ Ready | images/search-screenshot.png |
| Screenshot 2 (Details) | 1280×800 | ✅ Ready | images/details-screenshot.png |
| Screenshot 3 (Maps) | 1280×800 | ✅ Ready | images/maps-screenshot.png |
| Screenshot 4 (Options Dashboard) | 1280×800 | ✅ Ready | images/options-dashboard-screenshot.png |
| Small Promo Tile | 440×280 | ✅ Ready | images/promo-small.png |
| Marquee Promo Tile | 1400×560 | ✅ Ready | images/promo-marquee.png |

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves user preferences for earning levels, pricing methods, background search depth, and room expansion across browser sessions. |
| `tabs` | permissions | Enables the background service worker to detect in-tab navigation on search.aadvantagehotels.com so rate calculations automatically refresh when changing searches or hotels. |
| `https://search.aadvantagehotels.com/*` | host_permissions | Required to read hotel pricing and miles earnings and display calculated miles-per-dollar values on AAdvantage Hotels pages. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

The extension processes page content strictly in local tab memory to calculate miles per dollar. No user data, booking information, credentials, or web browsing history is ever collected, tracked, or transmitted off-device.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 2.0.0 | 2026-10-09 | Major release: completely rebuilt to support the new AAdvantage Hotels website (search.aadvantagehotels.com). Adds background multi-page deal discovery, CPM acquisition cost, relative price ratings, native MPD sorting, and status tier earning level preferences. | Published |
| 1.5.0 | 2026-09-20 | MPD rate history, IndexedDB analytics dashboard, sweet spot finder, map pin network interception, all-in pricing, and CSV/SQL export. | Published |
| 1.4.0 | 2024-11-15 | Added configuration options for room rates, room types, and bonus miles. | Published |
| 1.3.0 | 2024-10-20 | Support for total pricing calculation. | Published |
| 1.2.0 | 2024-09-15 | Support base URL with search parameters. | Published |
