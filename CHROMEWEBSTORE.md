# Chrome Web Store Listing — AA Hotels MPD

> Last Updated: 2026-10-09

## Store Listing

**Extension Name**
AA Hotels MPD

**Short Description**
Calculates and displays Miles Per Dollar (MPD), acquisition CPM, and comparative value metrics on AAdvantage Hotels.

**Detailed Description**
Maximize your American Airlines AAdvantage® earnings and Loyalty Points when booking hotels!

AA Hotels MPD automatically calculates and displays the Miles Per Dollar (MPD), Cents Per Mile (CPM) acquisition cost, and comparative pricing metrics for every hotel search result and room rate on AAdvantage Hotels, helping you instantly spot the highest-value booking options.

Key features:
- **3-Row Value Chips:** Displays Miles Per Dollar (MPD), Cents Per Mile (CPM), and nightly price with relative color indicators (🟢 High, 🟡 Medium, 🔴 Low) and price ratings (💲 to 💲💲💲).
- **Location Best Earn Rate Banner:** Highlights the highest earn rate found across the search destination with real-time loading feedback.
- **Background Search Pagination:** Automatically queries additional search result pages (configurable depth cap, default 5 pages) to surface top earn rates across the whole destination without endless manual clicking.
- **Native MPD Sort:** Adds a branded "Most miles per dollar" sort option directly to the search results sort bar.
- **Earning Level Customization:** Choose between AAdvantage® Member and Credit Cardmember with Status base earn tiers to match your account.
- **Pricing Customization:** Choose all-in total pricing (including taxes & fees) or base price, and easily toggle promotional bonus miles offers.
- **Completely Private and Local:** Runs 100% in your browser. Zero tracking, zero analytics, and zero data transmitted to any external servers.

How to use:
1. Navigate to search.aadvantagehotels.com and perform any hotel search.
2. The extension automatically calculates and displays Miles Per Dollar chips on search cards and pins.
3. Use the "Most miles per dollar" sort option to instantly sort results descending by earn rate.
4. Click through to any hotel room details page to compare earn rates across different room types.

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
| `storage` | permissions | Saves user preferences for earning levels, pricing methods, background query limits, and room expansion across browser sessions. |
| `tabs` | permissions | Enables the background service worker to detect in-tab SPA navigation events on aadvantagehotels.com so rate calculations automatically refresh when changing searches or hotels. |
| `https://search.aadvantagehotels.com/*` | host_permissions | Required to read hotel pricing and miles earnings from the DOM and inject calculated miles-per-dollar badges on AAdvantage Hotels pages. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

The extension processes DOM content and intercepted API responses strictly in local tab memory to calculate miles per dollar. No user data, booking information, credentials, or web browsing history is ever collected, tracked, or transmitted off-device.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 2.0.0 | 2026-10-09 | Major release: 3-row branded MPD chips with CPM & price ratings, background multi-page search querying with configurable depth cap, location best earn rate banner with live status, native MPD sort in sort-bar-container, earning tier preferences, and bonus miles toggles. | Published |
| 1.5.0 | 2026-09-20 | MPD rate history, IndexedDB analytics dashboard, sweet spot finder, map pin network interception, all-in pricing, and CSV/SQL export. | Published |
| 1.4.0 | 2024-11-15 | Added configuration options for room rates, room types, and bonus miles. | Published |
| 1.3.0 | 2024-10-20 | Support for total pricing calculation. | Published |
| 1.2.0 | 2024-09-15 | Support base URL with search parameters. | Published |
