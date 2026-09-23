# Chrome Web Store Listing — AA Hotels MPD

> Last Updated: 2026-09-19

## Store Listing

**Extension Name**
AA Hotels MPD

**Short Description**
Calculates and displays estimated miles earned per dollar on AAdvantage Hotels search results and room details.

**Detailed Description**
Maximize your American Airlines AAdvantage® earnings when booking hotels!

AA Hotels MPD automatically calculates and displays the Miles Per Dollar (MPD) for every hotel search result and room rate on AAdvantage Hotels, helping you quickly identify the highest-value earning opportunities.

Key features:
- Automatically calculates and injects Miles Per Dollar (MPD) directly next to earn rewards.
- Highlights high earn rates (over 20 miles/$) in bold green for quick scanning.
- Displays the top earn rate banner at the top of the search results and room details pages.
- Seamlessly updates as you navigate between searches, filters, and room details.
- Optional settings to include bonus miles offers, expand room rates, and auto-expand room types.
- Completely private and local: runs entirely in your browser with zero tracking or external analytics.

How to use:
1. Navigate to aadvantagehotels.com and perform any hotel search.
2. The extension automatically detects the results and calculates the miles per dollar.
3. Open any hotel details page to compare miles-per-dollar earn rates across different room types.

**Category**
Search Tools

**Single Purpose**
Calculates and displays the estimated miles earned per dollar on AAdvantage Hotels booking pages.

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

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves user preferences for room expansion, bonus miles inclusion, and debug options across browser sessions. |
| `tabs` | permissions | Enables the background service worker to detect in-tab SPA navigation events on aadvantagehotels.com so rate calculations automatically refresh when changing searches or hotels. |
| `https://www.aadvantagehotels.com/*` | host_permissions | Required to read hotel pricing and miles earnings from the DOM and inject calculated miles-per-dollar badges on AAdvantage Hotels pages. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

The extension processes DOM content strictly in local tab memory to calculate miles per dollar. No user data, booking information, credentials, or web browsing history is ever collected, tracked, or transmitted off-device.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.5.0 | 2026-09-20 | MPD rate history, IndexedDB analytics dashboard, sweet spot finder, map pin network interception, all-in pricing, and CSV/SQL export. | Published |
| 1.4.0 | 2024-11-15 | Added configuration options for room rates, room types, and bonus miles. | Published |
| 1.3.0 | 2024-10-20 | Support for total pricing calculation. | Published |
| 1.2.0 | 2024-09-15 | Support base URL with search parameters. | Published |
