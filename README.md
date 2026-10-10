# AA Hotels MPD

A free, privacy-first Chrome extension that helps you find the highest-earning American Airlines AAdvantage® hotel bookings on the new [AAdvantage Hotels](https://search.aadvantagehotels.com) site.

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-AA%20Hotels%20MPD-blue?logo=google-chrome)](https://chromewebstore.google.com/detail/aa-hotels-mpd/ojdenlcjodnolmcgdpghhmdlmginhiei)

![Search results overview with miles per dollar](./images/search-screenshot.png?raw=true "Search results overview with miles per dollar")

---

## What It Does For You

When you search for hotels on AAdvantage Hotels, hotel rates vary dramatically in how many miles and Loyalty Points they reward. One hotel might offer 10 miles per dollar spent, while another next door offers 28 miles per dollar.

**AA Hotels MPD** automatically analyzes rates as you browse and highlights the best earning opportunities:

- **Miles Per Dollar (MPD):** See the exact miles-per-dollar earn rate directly on each hotel card and room option.
- **Acquisition Cost (CPM):** See your cost per mile in cents (CPM), making it easy to decide if paying slightly more for a room is a cost-effective way to earn miles toward elite status.
- **Quick-Scan Value Colors:** Color-coded dots show how a hotel's earn rate compares to other options in your search:
  - 🟢 **Green** — Top-tier earn rate in your search set
  - 🟡 **Yellow** — Average earn rate
  - 🔴 **Red** — Below-average earn rate
- **Relative Price Ratings:** 💲 to 💲💲💲 shows where each hotel falls within your search's price range.
- **Top Earn Rate Banner:** A banner at the top of results displays the highest earn rate found for your entire destination.
- **Automatic Multi-Page Scanning:** The extension automatically checks additional pages of results in the background, so you can discover top-earning hotels that might otherwise be buried on page 3 or 4.
- **Sort by Miles Per Dollar:** Adds a "Most miles per dollar" sort option right into the site's sort menu, ranking search results by earn rate with a single click.
- **Customized for Your Status Tier:** Select whether you're an *AAdvantage® Member* or an *AAdvantage® Credit Cardmember with Status* so calculations reflect what you will actually earn.
- **All-In Pricing:** Calculates earn rates against the full total price (including taxes and fees) so there are no surprises at checkout.
- **100% Private:** Runs entirely on your computer. No accounts, no analytics, no ads, and no personal data ever leaves your browser.

---

## What's New in Version 2.0

Version 2.0 is a complete rebuild designed specifically for the **new AAdvantage Hotels platform** at `search.aadvantagehotels.com`:

- **Adapted to the new website:** Fully rewritten to support the new booking site, interactive maps, and updated room selection interface.
- **Multi-page deal discovery:** Scans subsequent result pages automatically so you don't miss high-earning properties on later pages.
- **In-page MPD sort:** Restores one-click sorting by earn rate directly within the search results sort bar.
- **Cost-per-mile metric (CPM):** Added to help you quickly assess whether a higher room rate makes sense for earning miles.
- **Earning tier selection:** Choose between general member and status cardmember rates for accurate Loyalty Point calculations.

---

## How to Use It

1. Install **AA Hotels MPD** from the [Chrome Web Store](https://chromewebstore.google.com/detail/aa-hotels-mpd/ojdenlcjodnolmcgdpghhmdlmginhiei).
2. Go to [search.aadvantagehotels.com](https://search.aadvantagehotels.com) and search for any city or destination.
3. Each hotel card and map pin automatically displays its earn rate, CPM, and value rating.
4. Select **"Most miles per dollar"** in the sort menu to rank hotels from highest to lowest earn rate.
5. Click into any hotel to compare earn rates across different room types.
6. Click the extension icon or visit Options to select your earning level, adjust background search depth, or customize pricing settings.

---

## Development

If you want to build or run the extension locally:

```bash
# Clone the repository
git clone https://github.com/bernot-dev/aa-hotels-mpd.git
cd aa-hotels-mpd

# Install dependencies
npm install

# Build the extension bundle
npm run build

# Run automated tests
npm test
```

`npm run build:dev` (or `npm run watch`) makes a development build that also includes the debug panel for exporting DOM and network test fixtures. Turn the panel on from the extension's service worker console with `chrome.storage.sync.set({ showDebugButton: true })`. Production builds leave the debug tooling out entirely, and `npm test` fails if the committed `dist/` isn't a production build, so run `npm run build` before committing.

To load the built extension into Chrome:
1. Navigate to `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** in the upper right corner.
3. Click **Load unpacked** and select the repository directory.

---

## License

MIT
