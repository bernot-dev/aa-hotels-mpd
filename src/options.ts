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
import { DashboardStats, TopMpdRecord, LocationStatRecord } from "./types";

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

// 2. Render Top MPDs Table
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
    toggleBtn.textContent = showAll ? "Show Top 3" : `Show Top 100 (${records.length})`;
  }

  const displayed = showAll ? records.slice(0, 100) : records.slice(0, 3);
  tbody.innerHTML = displayed
    .map((r, index) => {
      const isHigh = r.mpd >= 20;
      return `
        <tr>
          <td><b>#${index + 1}</b></td>
          <td><span class="mpd-badge ${isHigh ? "high" : ""}">${r.mpd.toFixed(1)}</span></td>
          <td>${escapeHtml(r.hotelName)}</td>
          <td>${escapeHtml(r.location)}</td>
          <td>${escapeHtml(r.checkIn)} → ${escapeHtml(r.checkOut)}</td>
          <td>${r.nights}</td>
          <td>$${r.price.toLocaleString()}</td>
          <td>${r.miles.toLocaleString()}</td>
          <td style="text-align: right;"><button class="btn-delete-item btn-delete-top" data-id="${escapeHtml(r.id)}" title="Delete this rate">✕</button></td>
        </tr>
      `;
    })
    .join("");
}

// 3. Render Locations Table
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

// 4. Render Nights Breakdown (1-7 nights)
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

// 5. Load and Render Dashboard
async function loadDashboard(): Promise<void> {
  try {
    currentStats = await getDashboardStats();
    renderTopMpds(currentStats.topMpds, showAllTopMpds);
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

  // Toggle buttons
  document.getElementById("toggleTopMpds")?.addEventListener("click", () => {
    showAllTopMpds = !showAllTopMpds;
    if (currentStats) {
      renderTopMpds(currentStats.topMpds, showAllTopMpds);
    }
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
