import {
  getDashboardStats,
  getStorageEstimate,
  getExhaustiveQueries,
  clearAllData,
  deleteLocationStat,
  deleteTopMpdRecord,
} from "./db/db";
import { exportQueriesToCsv } from "./export/csv";
import { exportQueriesToSql } from "./export/sql";
import { triggerFileDownload } from "./export/download";
import {
  DashboardStats,
  TopMpdRecord,
  LocationStatRecord,
  ChainStat,
  SeasonalityStats,
} from "./types";
import {
  identifyHotelChain,
  computeValueScore,
  computeCpm,
  deduplicateRecordsByHotel,
} from "./analytics";

export type Config = {
  expandRoomRates: boolean;
  expandRoomTypes: boolean;
  expandSearchResults: boolean;
  includeBonusMiles: boolean;
  showDebugButton: boolean;
  keepExhaustiveQueryHistory?: boolean;
};

let currentStats: DashboardStats | null = null;
let showAllTopMpds = false;
let showAllTopLocs = false;
let showAllLowestLocs = false;
let selectedChainFilter = "";
let selectedLocationFilter = "";

// 1. Tab Navigation
function setupTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab-btn");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

      tab.classList.add("active");
      const targetId = tab.dataset.tab;
      if (targetId) {
        document.getElementById(targetId)?.classList.add("active");
      }
    });
  });
}

// 2. Top 3 Visual Property Cards Showcase
function renderTop3VisualCards(records: TopMpdRecord[]): void {
  const container = document.getElementById("top3VisualContainer");
  const cardsGrid = document.getElementById("top3VisualCards");
  if (!container || !cardsGrid) return;

  const distinctTop = deduplicateRecordsByHotel(records);
  const top3 = distinctTop.slice(0, 3);
  if (top3.length === 0) {
    container.style.display = "none";
    cardsGrid.innerHTML = "";
    return;
  }

  container.style.display = "block";
  cardsGrid.innerHTML = top3
    .map((r, index) => {
      const rank = index + 1;
      const chain = r.chain || identifyHotelChain(r.hotelName);
      const cpm = r.cpm ?? computeCpm(r.price, r.miles);
      const valScore = r.valueScore ?? computeValueScore(r.mpd, r.rating);
      const bookingUrl = r.hotelId
        ? `https://www.aadvantagehotels.com/details?id=${encodeURIComponent(r.hotelId)}&checkIn=${encodeURIComponent(r.checkIn)}&checkOut=${encodeURIComponent(r.checkOut)}`
        : `https://www.aadvantagehotels.com`;

      const imgHtml = r.imageUrl
        ? `<img class="property-card-img" src="${escapeHtml(r.imageUrl)}" alt="${escapeHtml(r.hotelName)}" onerror="this.parentElement.innerHTML='<div style=\\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:36px;\\\'>🏨</div>'"/>`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:36px;background:linear-gradient(135deg, #1e293b 0%, #334155 100%);">🏨</div>`;

      const starsHtml = r.stars
        ? `<span class="star-rating" title="${r.stars} Stars">${"★".repeat(Math.min(5, Math.round(r.stars)))}</span>`
        : "";

      const ratingHtml = typeof r.rating === "number" && r.rating > 0
        ? `<span class="pill-badge rating">⭐ ${r.rating.toFixed(1)}/10${r.reviewCount ? ` (${r.reviewCount})` : ""}</span>`
        : "";

      const refundableHtml = r.refundable
        ? `<span class="pill-badge refundable">✓ Refundable</span>`
        : "";

      return `
        <div class="property-card">
          <div class="property-card-img-wrap">
            ${imgHtml}
            <div class="property-card-rank rank-${rank}">Rank #${rank}</div>
          </div>
          <div class="property-card-body">
            <div class="property-card-title" title="${escapeHtml(r.hotelName)}">${escapeHtml(r.hotelName)}</div>
            <div class="property-card-location">📍 ${escapeHtml(r.location)}</div>
            <div class="property-card-badges">
              ${starsHtml}
              ${ratingHtml}
              <span class="pill-badge chain">${escapeHtml(chain)}</span>
              <span class="score-badge" title="Sweet Spot Score (Quality × MPD)">🎯 ${valScore.toFixed(1)}</span>
              ${refundableHtml}
            </div>
            <div class="property-card-metrics">
              <div>
                <div class="property-card-mpd">${r.mpd.toFixed(1)} <span style="font-size: 12px; font-weight: 600;">MPD</span></div>
                <div class="property-card-cpm">${cpm > 0 ? `${cpm.toFixed(1)}¢ / mile` : ""}</div>
              </div>
              <div>
                <div class="property-card-price">$${r.price.toLocaleString()}</div>
                <div style="font-size: 11px; color: var(--text-muted); text-align: right;">${r.miles.toLocaleString()} miles (${r.nights}n)</div>
              </div>
            </div>
            <a href="${bookingUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" style="margin-top: 12px; justify-content: center; text-decoration: none;">
              Book Deal on AA Hotels ↗
            </a>
          </div>
        </div>
      `;
    })
    .join("");
}

// 3. Hotel Brand & Chain Leaderboard
function populateChainFilterOptions(chains: ChainStat[] = []): void {
  const select = document.getElementById("filterChain") as HTMLSelectElement | null;
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = `<option value="">All Brands & Chains</option>`;
  for (const c of chains) {
    const opt = document.createElement("option");
    opt.value = c.chain;
    opt.textContent = `${c.chain} (${c.count})`;
    select.appendChild(opt);
  }
  select.value = selectedChainFilter || currentVal || "";
}

function renderChainLeaderboard(chains: ChainStat[] = []): void {
  const container = document.getElementById("chainsList");
  const empty = document.getElementById("chainsEmpty");
  if (!container || !empty) return;

  if (chains.length === 0) {
    container.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  container.innerHTML = chains
    .map(
      (c) => `
        <div class="chain-card ${c.chain === selectedChainFilter ? "selected" : ""}" data-chain="${escapeHtml(c.chain)}">
          <div class="chain-card-header">
            <span class="chain-card-name">${escapeHtml(c.chain)}</span>
            <span class="chain-card-count">${c.count} ${c.count === 1 ? "deal" : "deals"}</span>
          </div>
          <div class="chain-card-mpd">${c.avgMpd.toFixed(1)} <span style="font-size: 11px; font-weight: 600;">avg MPD</span></div>
          <div class="chain-card-sub" style="color: var(--text);">Top: ${c.bestMpd.toFixed(1)} MPD${c.avgCpm > 0 ? ` · ${c.avgCpm.toFixed(1)}¢/mi` : ""}</div>
          <div class="chain-card-sub" style="font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.topHotel)}">
            ${escapeHtml(c.topHotel)}
          </div>
        </div>
      `
    )
    .join("");
}

// 4. Seasonality & Booking Window Analytics
function renderSeasonality(seasonality?: SeasonalityStats): void {
  const list = document.getElementById("bookingWindowsList");
  const empty = document.getElementById("bookingWindowsEmpty");
  const weekdayBox = document.getElementById("seasonalityWeekdayBox");

  const windows = seasonality?.bookingWindows || [];
  if (list && empty) {
    const hasData = windows.some((b) => b.count > 0);
    if (!hasData) {
      list.innerHTML = "";
      empty.style.display = "block";
    } else {
      empty.style.display = "none";
      list.innerHTML = windows
        .map(
          (b) => `
            <div class="booking-window-row">
              <span style="font-weight: 600;">${escapeHtml(b.label)}</span>
              <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 12px; color: var(--text-muted);">${b.count} ${b.count === 1 ? "rate" : "rates"}</span>
                <span class="mpd-badge ${b.avgMpd >= 20 ? "high" : ""}">${b.avgMpd > 0 ? `${b.avgMpd.toFixed(1)} m/$` : "—"}</span>
              </div>
            </div>
          `
        )
        .join("");
    }
  }

  if (weekdayBox) {
    const weekdayAvg = seasonality?.weekdayAvgMpd || 0;
    const weekendAvg = seasonality?.weekendAvgMpd || 0;
    weekdayBox.innerHTML = `
      <div class="weekday-weekend-card">
        <div class="day-type-box">
          <div class="day-type-title">Weekday Check-In</div>
          <div class="day-type-mpd">${weekdayAvg > 0 ? `${weekdayAvg.toFixed(1)}` : "—"} <span style="font-size: 12px; font-weight: 600;">m/$</span></div>
          <div class="day-type-sub">Sun – Thu Check-In</div>
        </div>
        <div class="day-type-box">
          <div class="day-type-title">Weekend Check-In</div>
          <div class="day-type-mpd" style="color: #15803d;">${weekendAvg > 0 ? `${weekendAvg.toFixed(1)}` : "—"} <span style="font-size: 12px; font-weight: 600;">m/$</span></div>
          <div class="day-type-sub">Fri – Sat Check-In</div>
        </div>
      </div>
    `;
  }
}

// 5. Filtering and Sorting for Top MPDs
function populateLocationFilterOptions(records: TopMpdRecord[]): void {
  const select = document.getElementById("filterLocation") as HTMLSelectElement | null;
  if (!select) return;

  const currentVal = select.value;
  const locCounts = new Map<string, number>();
  for (const r of records) {
    const loc = (r.location || "").trim();
    if (loc && loc !== "Unknown Location") {
      locCounts.set(loc, (locCounts.get(loc) || 0) + 1);
    }
  }

  const sortedLocs = Array.from(locCounts.keys()).sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">All Locations</option>`;
  for (const loc of sortedLocs) {
    const opt = document.createElement("option");
    opt.value = loc;
    opt.textContent = `${loc} (${locCounts.get(loc)})`;
    select.appendChild(opt);
  }
  select.value = selectedLocationFilter || currentVal || "";
}

function applyFiltersAndSort(records: TopMpdRecord[]): TopMpdRecord[] {
  const locationSelect = document.getElementById("filterLocation") as HTMLSelectElement | null;
  const minRatingSelect = document.getElementById("filterMinRating") as HTMLSelectElement | null;
  const minStarsSelect = document.getElementById("filterMinStars") as HTMLSelectElement | null;
  const sortBySelect = document.getElementById("filterSortBy") as HTMLSelectElement | null;
  const refundableCb = document.getElementById("filterRefundableOnly") as HTMLInputElement | null;
  const under150Cb = document.getElementById("filterUnder150") as HTMLInputElement | null;

  const selectedLoc = locationSelect?.value || selectedLocationFilter || "";
  const minRating = parseFloat(minRatingSelect?.value || "0");
  const minStars = parseFloat(minStarsSelect?.value || "0");
  const sortBy = sortBySelect?.value || "mpd";
  const refundableOnly = refundableCb?.checked || false;
  const under150 = under150Cb?.checked || false;

  const filtered = records.filter((r) => {
    if (selectedLoc && r.location !== selectedLoc) return false;
    const chain = r.chain || identifyHotelChain(r.hotelName);
    if (selectedChainFilter && chain !== selectedChainFilter) return false;
    if (minRating > 0 && (!r.rating || r.rating < minRating)) return false;
    if (minStars > 0 && (!r.stars || r.stars < minStars)) return false;
    if (refundableOnly && !r.refundable) return false;
    if (under150 && r.price >= 150) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === "value") {
      const valA = a.valueScore ?? computeValueScore(a.mpd, a.rating);
      const valB = b.valueScore ?? computeValueScore(b.mpd, b.rating);
      return valB - valA;
    } else if (sortBy === "cpm") {
      const cpmA = a.cpm ?? computeCpm(a.price, a.miles);
      const cpmB = b.cpm ?? computeCpm(b.price, b.miles);
      // Lowest CPM first; if 0 (missing miles), sort to the bottom
      if (cpmA <= 0 && cpmB <= 0) return 0;
      if (cpmA <= 0) return 1;
      if (cpmB <= 0) return -1;
      return cpmA - cpmB;
    } else if (sortBy === "price") {
      return a.price - b.price;
    } else {
      return b.mpd - a.mpd;
    }
  });

  // Deduplicate so each hotel is featured at most once with its best rate under current sort
  return deduplicateRecordsByHotel(filtered);
}

function renderFilteredTopMpds(): void {
  if (!currentStats) return;
  const filtered = applyFiltersAndSort(currentStats.topMpds);
  renderTopMpds(filtered, showAllTopMpds);
}

// 6. Render Top MPDs Table
function renderTopMpds(records: TopMpdRecord[], showAll: boolean): void {
  const tbody = document.getElementById("topMpdsBody");
  const table = document.getElementById("topMpdsTable");
  const empty = document.getElementById("topMpdsEmpty");
  const toggleBtn = document.getElementById("toggleTopMpds") as HTMLButtonElement | null;

  if (!tbody || !table || !empty) return;

  if (records.length === 0) {
    table.style.display = "none";
    empty.style.display = "block";
    if (toggleBtn) toggleBtn.style.display = "none";
    return;
  }

  table.style.display = "table";
  empty.style.display = "none";
  if (toggleBtn) {
    toggleBtn.style.display = records.length > 3 ? "inline-flex" : "none";
    toggleBtn.textContent = showAll ? "Show Top 3" : `Show All (${records.length})`;
  }

  const displayed = showAll ? records.slice(0, 100) : records.slice(0, 3);
  tbody.innerHTML = displayed
    .map((r, index) => {
      const isHigh = r.mpd >= 20;
      const chain = r.chain || identifyHotelChain(r.hotelName);
      const valScore = r.valueScore ?? computeValueScore(r.mpd, r.rating);
      const cpm = r.cpm ?? computeCpm(r.price, r.miles);
      const bookingUrl = r.hotelId
        ? `https://www.aadvantagehotels.com/details?id=${encodeURIComponent(r.hotelId)}&checkIn=${encodeURIComponent(r.checkIn)}&checkOut=${encodeURIComponent(r.checkOut)}`
        : "";

      return `
        <tr>
          <td><b>#${index + 1}</b></td>
          <td><span class="mpd-badge ${isHigh ? "high" : ""}">${r.mpd.toFixed(1)}</span></td>
          <td><span class="score-badge" title="Quality × MPD">${valScore.toFixed(1)}</span></td>
          <td><span class="cpm-badge" title="Cost per mile">${cpm > 0 ? `${cpm.toFixed(1)}¢` : "—"}</span></td>
          <td>
            <div style="font-weight: 600; line-height: 1.3;">${escapeHtml(r.hotelName)}</div>
            <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 6px; align-items: center; margin-top: 2px;">
              ${r.stars ? `<span class="star-rating" title="${r.stars} Stars">${"★".repeat(Math.min(5, Math.round(r.stars)))}</span>` : ""}
              ${typeof r.rating === "number" && r.rating > 0 ? `<span>⭐ ${r.rating.toFixed(1)}</span>` : ""}
              ${r.refundable ? `<span style="color: #15803d; font-weight: 600;">✓ Ref</span>` : ""}
            </div>
          </td>
          <td><span style="font-size: 12px;">${escapeHtml(chain)}</span></td>
          <td>${escapeHtml(r.location)}</td>
          <td><span style="white-space: nowrap;">${escapeHtml(r.checkIn)} → ${escapeHtml(r.checkOut)}</span></td>
          <td>${r.nights}</td>
          <td>$${r.price.toLocaleString()}</td>
          <td>${r.miles.toLocaleString()}</td>
          <td style="text-align: right; white-space: nowrap;">
            ${bookingUrl ? `<a href="${bookingUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; margin-right: 8px; font-size: 13px;" title="View on AA Hotels">↗</a>` : ""}
            <button class="btn-delete-item btn-delete-top" data-id="${escapeHtml(r.id)}" title="Delete this rate">✕</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

// 7. Render Locations Table
function renderLocationsTable(
  tbodyId: string,
  emptyId: string,
  toggleId: string,
  records: LocationStatRecord[],
  showAll: boolean
): void {
  const tbody = document.getElementById(tbodyId);
  const empty = document.getElementById(emptyId);
  const toggleBtn = document.getElementById(toggleId) as HTMLButtonElement | null;

  if (!tbody || !empty) return;

  if (records.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    if (toggleBtn) toggleBtn.style.display = "none";
    return;
  }

  empty.style.display = "none";
  if (toggleBtn) {
    toggleBtn.style.display = records.length > 3 ? "inline-flex" : "none";
    toggleBtn.textContent = showAll ? "Show Top 3" : `Show All (${records.length})`;
  }

  const displayed = showAll ? records : records.slice(0, 3);
  tbody.innerHTML = displayed
    .map((loc) => {
      const isHigh = loc.topMpd >= 20;
      return `
        <tr>
          <td><b>${escapeHtml(loc.location)}</b></td>
          <td><span class="mpd-badge ${isHigh ? "high" : ""}">${loc.topMpd.toFixed(1)}</span></td>
          <td>${escapeHtml(loc.hotelName)}</td>
          <td style="text-align: right;"><button class="btn-delete-item btn-delete-loc" data-location="${escapeHtml(loc.location)}" title="Delete this location">✕</button></td>
        </tr>
      `;
    })
    .join("");
}

// 8. Render Nights Breakdown (1-7 nights)
function renderNightsBreakdown(stats: DashboardStats): void {
  const container = document.getElementById("nightsGrid");
  if (!container) return;

  let html = "";
  for (let n = 1; n <= 7; n++) {
    const record = stats.nightsStats[n];
    if (record) {
      html += `
        <div class="night-card">
          <div class="night-card-title">${n} ${n === 1 ? "Night" : "Nights"}</div>
          <div class="night-card-mpd">${record.topMpd.toFixed(1)} <span style="font-size: 11px;">m/$</span></div>
          <div class="night-card-sub" title="${escapeHtml(record.hotelName)}">${escapeHtml(record.hotelName)}</div>
          <div class="night-card-sub" title="${escapeHtml(record.location)}">${escapeHtml(record.location)}</div>
        </div>
      `;
    } else {
      html += `
        <div class="night-card" style="opacity: 0.65;">
          <div class="night-card-title">${n} ${n === 1 ? "Night" : "Nights"}</div>
          <div class="night-card-mpd" style="color: var(--text-muted); font-size: 14px; margin: 6px 0;">No data</div>
          <div class="night-card-sub">—</div>
        </div>
      `;
    }
  }
  container.innerHTML = html;
}

// 9. Load and Render Dashboard
async function loadDashboard(): Promise<void> {
  try {
    currentStats = await getDashboardStats();
    renderTop3VisualCards(currentStats.topMpds);
    populateLocationFilterOptions(currentStats.topMpds);
    populateChainFilterOptions(currentStats.chainStats);
    renderChainLeaderboard(currentStats.chainStats);
    renderSeasonality(currentStats.seasonality);
    renderFilteredTopMpds();
    renderLocationsTable(
      "topLocsBody",
      "topLocsEmpty",
      "toggleTopLocs",
      currentStats.allLocations,
      showAllTopLocs
    );
    renderLocationsTable(
      "lowestLocsBody",
      "lowestLocsEmpty",
      "toggleLowestLocs",
      currentStats.lowestLocations,
      showAllLowestLocs
    );
    renderNightsBreakdown(currentStats);
  } catch (err) {
    console.error("[AA-Hotels-MPD] Failed to load dashboard stats:", err);
  }
}

// 6. Update Storage Usage Readout
async function updateStorageReadout(): Promise<void> {
  const readout = document.getElementById("storageReadout");
  if (!readout) return;
  readout.textContent = "Calculating...";

  try {
    const estimate = await getStorageEstimate();
    readout.textContent = estimate.humanized;
  } catch (err) {
    readout.textContent = "Unavailable";
    console.error("[AA-Hotels-MPD] Storage estimate failed:", err);
  }
}

// 7. Export Handlers
async function handleExportCsv(): Promise<void> {
  try {
    const queries = await getExhaustiveQueries();
    if (queries.length === 0) {
      alert("No exhaustive queries stored yet.\nEnsure 'Keep an exhaustive list of every query ever' is enabled in options and you have searched on AA Hotels.");
      return;
    }
    const csv = exportQueriesToCsv(queries);
    const dateStr = new Date().toISOString().split("T")[0];
    triggerFileDownload(csv, `aa-hotels-queries-${dateStr}.csv`, "text/csv;charset=utf-8");
  } catch (err) {
    alert(`Failed to export CSV: ${err}`);
  }
}

async function handleExportSql(): Promise<void> {
  try {
    const queries = await getExhaustiveQueries();
    if (queries.length === 0) {
      alert("No exhaustive queries stored yet.\nEnsure 'Keep an exhaustive list of every query ever' is enabled in options and you have searched on AA Hotels.");
      return;
    }
    const sql = exportQueriesToSql(queries);
    const dateStr = new Date().toISOString().split("T")[0];
    triggerFileDownload(sql, `aa-hotels-queries-${dateStr}.sql`, "application/sql;charset=utf-8");
  } catch (err) {
    alert(`Failed to export SQL: ${err}`);
  }
}

async function handleDeleteHistory(): Promise<void> {
  const confirmed = confirm(
    "Are you sure you want to permanently delete all stored query history and dashboard data?\nThis action cannot be undone."
  );
  if (!confirmed) return;

  try {
    await clearAllData();
    await loadDashboard();
    await updateStorageReadout();
    alert("All stored history and dashboard data have been deleted successfully.");
  } catch (err) {
    alert(`Failed to clear data: ${err}`);
  }
}

// 8. Options Save & Restore
async function saveOptions(): Promise<void> {
  const expandRoomRates = (document.getElementById("expandRoomRates") as HTMLInputElement).checked;
  const expandRoomTypes = (document.getElementById("expandRoomTypes") as HTMLInputElement).checked;
  const expandSearchResults = (document.getElementById("expandSearchResults") as HTMLInputElement).checked;
  const includeBonusMiles = (document.getElementById("includeBonusMiles") as HTMLInputElement).checked;
  const showDebugButton = (document.getElementById("showDebugButton") as HTMLInputElement).checked;
  const keepExhaustiveQueryHistory = (
    document.getElementById("keepExhaustiveQueryHistory") as HTMLInputElement
  ).checked;

  const pricingSelect = document.getElementById("pricingCalculationMethod") as HTMLSelectElement | null;
  const pricingCalculationMethod = pricingSelect?.value === "base" ? "base" : "all_in";
  const useAllInPricing = pricingCalculationMethod === "all_in";

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      await chrome.storage.sync.set({
        expandRoomRates,
        expandRoomTypes,
        expandSearchResults,
        includeBonusMiles,
        showDebugButton,
        keepExhaustiveQueryHistory,
        pricingCalculationMethod,
        useAllInPricing,
      });
    }

    const status = document.getElementById("status");
    if (status) {
      status.textContent = "Settings saved.";
      setTimeout(() => {
        status.textContent = "";
      }, 1500);
    }
  } catch {
    const status = document.getElementById("status");
    if (status) {
      status.style.color = "red";
      status.textContent = "Failed to save settings.";
    }
  }
}

async function restoreOptions(): Promise<void> {
  try {
    let config = {
      expandRoomRates: false,
      expandRoomTypes: false,
      expandSearchResults: true,
      includeBonusMiles: false,
      showDebugButton: true,
      keepExhaustiveQueryHistory: false,
      pricingCalculationMethod: "all_in",
      useAllInPricing: true,
    };

    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      config = (await chrome.storage.sync.get(config)) as typeof config;
    }

    const pricingSelect = document.getElementById("pricingCalculationMethod") as HTMLSelectElement | null;
    if (pricingSelect) {
      pricingSelect.value = config.pricingCalculationMethod === "base" ? "base" : "all_in";
    }

    const ratesEl = document.getElementById("expandRoomRates") as HTMLInputElement | null;
    if (ratesEl) ratesEl.checked = config.expandRoomRates;

    const typesEl = document.getElementById("expandRoomTypes") as HTMLInputElement | null;
    if (typesEl) typesEl.checked = config.expandRoomTypes;

    const searchEl = document.getElementById("expandSearchResults") as HTMLInputElement | null;
    if (searchEl) searchEl.checked = config.expandSearchResults;

    const bonusEl = document.getElementById("includeBonusMiles") as HTMLInputElement | null;
    if (bonusEl) bonusEl.checked = config.includeBonusMiles;

    const debugEl = document.getElementById("showDebugButton") as HTMLInputElement | null;
    if (debugEl) debugEl.checked = config.showDebugButton;

    const historyEl = document.getElementById("keepExhaustiveQueryHistory") as HTMLInputElement | null;
    if (historyEl) historyEl.checked = config.keepExhaustiveQueryHistory;
  } catch (err) {
    console.error("Failed to restore options:", err);
  }
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  restoreOptions();
  loadDashboard();
  updateStorageReadout();

  // Button listeners
  document.getElementById("save")?.addEventListener("click", saveOptions);
  document.getElementById("pricingCalculationMethod")?.addEventListener("change", saveOptions);
  document.getElementById("keepExhaustiveQueryHistory")?.addEventListener("change", saveOptions);
  document.getElementById("refreshStorageBtn")?.addEventListener("click", updateStorageReadout);
  document.getElementById("exportCsvBtn")?.addEventListener("click", handleExportCsv);
  document.getElementById("exportSqlBtn")?.addEventListener("click", handleExportSql);
  document.getElementById("deleteHistoryBtn")?.addEventListener("click", handleDeleteHistory);

  // Filter & Sort Toolbar listeners
  document.getElementById("filterLocation")?.addEventListener("change", (e) => {
    selectedLocationFilter = (e.target as HTMLSelectElement).value;
    renderFilteredTopMpds();
  });

  document.getElementById("filterChain")?.addEventListener("change", (e) => {
    selectedChainFilter = (e.target as HTMLSelectElement).value;
    document.querySelectorAll(".chain-card").forEach((card) => {
      const chainAttr = card.getAttribute("data-chain");
      if (chainAttr === selectedChainFilter) {
        card.classList.add("selected");
      } else {
        card.classList.remove("selected");
      }
    });
    renderFilteredTopMpds();
  });

  ["filterMinRating", "filterMinStars", "filterSortBy", "filterRefundableOnly", "filterUnder150"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      renderFilteredTopMpds();
    });
  });

  // Chain Leaderboard card click listener
  document.getElementById("chainsList")?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>(".chain-card");
    if (!card) return;
    const chain = card.getAttribute("data-chain") || "";
    if (selectedChainFilter === chain) {
      selectedChainFilter = "";
    } else {
      selectedChainFilter = chain;
    }
    const select = document.getElementById("filterChain") as HTMLSelectElement | null;
    if (select) select.value = selectedChainFilter;
    document.querySelectorAll(".chain-card").forEach((c) => {
      if (c.getAttribute("data-chain") === selectedChainFilter) {
        c.classList.add("selected");
      } else {
        c.classList.remove("selected");
      }
    });
    renderFilteredTopMpds();
  });

  // Toggle buttons
  document.getElementById("toggleTopMpds")?.addEventListener("click", () => {
    showAllTopMpds = !showAllTopMpds;
    renderFilteredTopMpds();
  });

  document.getElementById("toggleTopLocs")?.addEventListener("click", () => {
    showAllTopLocs = !showAllTopLocs;
    if (currentStats) {
      renderLocationsTable(
        "topLocsBody",
        "topLocsEmpty",
        "toggleTopLocs",
        currentStats.allLocations,
        showAllTopLocs
      );
    }
  });

  document.getElementById("toggleLowestLocs")?.addEventListener("click", () => {
    showAllLowestLocs = !showAllLowestLocs;
    if (currentStats) {
      renderLocationsTable(
        "lowestLocsBody",
        "lowestLocsEmpty",
        "toggleLowestLocs",
        currentStats.lowestLocations,
        showAllLowestLocs
      );
    }
  });

  // Table item deletion listeners
  document.getElementById("topMpdsBody")?.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>(".btn-delete-top");
    if (!btn || !btn.dataset.id) return;
    if (confirm("Delete this top MPD rate?")) {
      await deleteTopMpdRecord(btn.dataset.id);
      await loadDashboard();
    }
  });

  const handleLocationDelete = async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>(".btn-delete-loc");
    if (!btn || !btn.dataset.location) return;
    if (confirm(`Delete stats for location "${btn.dataset.location}"?`)) {
      await deleteLocationStat(btn.dataset.location);
      await loadDashboard();
    }
  };

  document.getElementById("topLocsBody")?.addEventListener("click", handleLocationDelete);
  document.getElementById("lowestLocsBody")?.addEventListener("click", handleLocationDelete);
});
