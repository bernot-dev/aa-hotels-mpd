// "Most miles per dollar" sort for the search results list.
//
// The site's sort options (in [data-element-name="sort-bar-container"]) are controlled by React,
// and their own options refetch the results. This option is handled entirely client-side: it stops the
// click event before React sees it, then reorders hotels with CSS `order` on the flex list (leaving
// DOM order, which React owns, intact). The choice persists across reloads until the user picks one
// of the site's own options.

export const MPD_SORT_LABEL = "Most miles per dollar";
export const MPD_SORT_STORAGE_KEY = "aa_hotels_mpd_sort";

export const SORT_BAR_CONTAINER_SELECTOR = '[data-element-name="sort-bar-container"]';
export const SORT_BUTTON_ID = "aa-mpd-sort-button";
export const SORT_CONTAINER_ID = "aa-mpd-sort-container";
export const SORT_BAR_STYLE_ID = "aa-mpd-sort-bar-style";

const STYLE_ID = "aa-mpd-sort-style";
const SORTED_ATTR = "data-aa-mpd-sorted";
const RESYNC_INTERVAL_MS = 500;

export function isMpdSortPreferred(): boolean {
  try {
    return localStorage.getItem(MPD_SORT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setMpdSortPreferred(preferred: boolean): void {
  try {
    if (preferred) {
      localStorage.setItem(MPD_SORT_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(MPD_SORT_STORAGE_KEY);
    }
  } catch {
    // Storage may be unavailable; the sort still works for this page view
  }
}

import { getLogoUrl } from "./logo";

/**
 * Ensures styles for the MPD sort button inside [data-element-name="sort-bar-container"].
 */
function ensureSortBarStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(SORT_BAR_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = SORT_BAR_STYLE_ID;
  style.textContent = `
    /* AA Hotels MPD Sort Bar Option */
    #${SORT_CONTAINER_ID} {
      display: flex;
      flex: 1;
      position: relative;
    }
    #${SORT_BUTTON_ID} {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      padding: 8px 16px !important;
      border-radius: 6px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      line-height: 1.2 !important;
      white-space: nowrap !important;
      text-decoration: none !important;
      box-sizing: border-box !important;
      user-select: none !important;
      cursor: pointer !important;
      transition: all 0.15s ease-in-out !important;
      background: #f0f6fd !important;
      color: #0b3558 !important;
      border: 1px solid #bfdbfe !important;
      box-shadow: 0 1px 2px rgba(11, 53, 88, 0.05) !important;
      height: 100% !important;
      width: 100% !important;
    }
    #${SORT_BUTTON_ID}:hover {
      background: #e2effd !important;
      border-color: #93c5fd !important;
    }
    #${SORT_BUTTON_ID}[aria-current="true"] {
      background: #00589c !important;
      color: #ffffff !important;
      border-color: #00589c !important;
      box-shadow: 0 2px 6px rgba(0, 88, 156, 0.35) !important;
    }
    #${SORT_BUTTON_ID}[aria-current="true"] .aa-mpd-sort-label {
      color: #ffffff !important;
    }
    #${SORT_BUTTON_ID} .aa-mpd-sort-logo {
      width: 18px !important;
      height: 18px !important;
      flex-shrink: 0 !important;
      display: block !important;
      object-fit: contain !important;
    }
    /* When MPD sort is active, override site's active button highlight */
    [data-element-name="sort-bar-container"][data-aa-mpd-active="true"] button[data-element-name^="search-sort-"]:not([data-element-name="search-sort-mpd"]) {
      background: #ffffff !important;
      color: #00589c !important;
      fill: #00589c !important;
      border: 1px solid #c4c4c4 !important;
    }
    [data-element-name="sort-bar-container"][data-aa-mpd-active="true"] button[data-element-name^="search-sort-"]:not([data-element-name="search-sort-mpd"]) span {
      color: #00589c !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Injects or retrieves the branded "Most miles per dollar" button in [data-element-name="sort-bar-container"].
 */
function ensureSortBarButton(sortBar: HTMLElement): HTMLElement {
  ensureSortBarStyle();
  const existingBtn = sortBar.querySelector<HTMLElement>(`#${SORT_BUTTON_ID}`);
  if (existingBtn) return existingBtn;

  const group = sortBar.querySelector<HTMLElement>('[role="group"]') || sortBar;

  const container = document.createElement("div");
  container.id = SORT_CONTAINER_ID;
  container.className =
    "afcde-box afcde-fill-inherit afcde-text-inherit afcde-flex afcde-flex-1 afcde-relative aa-mpd-sort-wrapper";
  container.setAttribute("data-aa-mpd", "true");

  const button = document.createElement("button");
  button.id = SORT_BUTTON_ID;
  button.setAttribute("data-element-name", "search-sort-mpd");
  button.setAttribute("data-aa-mpd", "true");
  button.setAttribute("aria-current", "false");
  button.type = "button";
  button.title = "Sort hotels by miles per dollar (AA Hotels MPD)";
  button.className =
    "afcde-box child-group afcde-w-full afcde-h-full afcde-items-center afcde-cursor-pointer afcde-flex afcde-flex-col afcde-justify-center afcde-px-16 afcde-py-8 afcde-rounded-base";

  const content = document.createElement("div");
  content.className =
    "afcde-box afcde-fill-inherit afcde-text-inherit afcde-items-center afcde-flex afcde-flex-row aa-mpd-sort-inner";
  content.style.display = "inline-flex";
  content.style.alignItems = "center";
  content.style.gap = "6px";

  const logoUrl = getLogoUrl(32);
  if (logoUrl) {
    const img = document.createElement("img");
    img.className = "aa-mpd-sort-logo";
    img.src = logoUrl;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.width = 18;
    img.height = 18;
    content.appendChild(img);
  }

  const label = document.createElement("span");
  label.className = "sc-aXZVg Typographystyled__TypographyStyled-sc-1uoovui-0 ifcRDN hjCBOp aa-mpd-sort-label";
  label.textContent = MPD_SORT_LABEL;
  content.appendChild(label);

  button.appendChild(content);
  container.appendChild(button);
  group.appendChild(container);

  return button;
}

/**
 * Updates the visual active state of the sort bar buttons.
 */
function updateSortBarState(sortBar: HTMLElement, isActive: boolean): void {
  const button = sortBar.querySelector<HTMLElement>(`#${SORT_BUTTON_ID}`);
  if (isActive) {
    sortBar.setAttribute("data-aa-mpd-active", "true");
    if (button) {
      button.setAttribute("aria-current", "true");
    }
    sortBar
      .querySelectorAll<HTMLElement>('button[data-element-name^="search-sort-"]:not([data-aa-mpd])')
      .forEach((btn) => {
        btn.setAttribute("aria-current", "false");
      });
  } else {
    sortBar.removeAttribute("data-aa-mpd-active");
    if (button) {
      button.setAttribute("aria-current", "false");
    }
  }
}

export function findHotelList(): HTMLElement | null {
  const modernList = document.querySelector<HTMLElement>("ol.hotel-list-container, .hotel-list-container");
  if (modernList) return modernList;

  const anyCard = document.querySelector('li.PropertyCardItem, [data-selenium="hotel-item"]');
  return (anyCard?.parentElement as HTMLElement) ?? null;
}

/** Best MPD shown in an item's badges, or -1 when it has none (sorted last). */
export function getItemMpd(item: Element): number {
  // Prefer the card's headline rate, which follows the selected earning level
  const card = item.matches("[data-aa-mpd-rate]") ? item : item.querySelector("[data-aa-mpd-rate]");
  const headline = parseFloat((card as HTMLElement | null)?.dataset.aaMpdRate || "");
  if (isFinite(headline) && headline > 0) return headline;

  let best = -1;
  item.querySelectorAll<HTMLElement>(".aa-mpd-badge[data-rate]").forEach((badge) => {
    const rate = parseFloat(badge.dataset.rate || "");
    if (isFinite(rate) && rate > best) best = rate;
  });
  return best;
}

export interface MpdSortController {
  /** Ensures the option exists, keeps the sort bar showing it, and (re)orders hotels if active. */
  apply(): void;
  teardown(): void;
}

export function setupMpdSort(): MpdSortController {
  let active = isMpdSortPreferred();
  // Badge updates scheduled before teardown can still call apply(); a disposed controller must not
  // restart its resync timer, or it would keep forcing the sort after the user picks another option.
  let disposed = false;
  let resyncTimer: ReturnType<typeof setInterval> | null = null;
  let sortedList: HTMLElement | null = null;
  let originalRowGap = "";

  const getSortBar = () => document.querySelector<HTMLElement>(SORT_BAR_CONTAINER_SELECTOR);

  const clearOrder = () => {
    if (!sortedList) return;
    Array.from(sortedList.children).forEach((child) => (child as HTMLElement).style.removeProperty("order"));
    sortedList.removeAttribute(SORTED_ATTR);
    sortedList.style.rowGap = originalRowGap;
    sortedList = null;
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    // The list spaces items with margins on every item but the first, which breaks once items are
    // visually reordered; swap that for row-gap while sorted. Items not ranked yet (just loaded)
    // sit at the end instead of flashing at the top with the default order of 0.
    style.textContent = `
      [${SORTED_ATTR}] { display: flex !important; flex-direction: column !important; }
      [${SORTED_ATTR}] > * { margin-top: 0 !important; order: 100000; }
    `;
    document.head.appendChild(style);
  };

  const applyOrder = () => {
    const list = findHotelList();
    if (!list) return;

    if (sortedList !== list) {
      clearOrder();
      const items = Array.from(list.children) as HTMLElement[];
      const spacing = items.length > 1 ? getComputedStyle(items[1]).marginTop : "";
      originalRowGap = list.style.rowGap;
      if (spacing && spacing !== "0px") list.style.rowGap = spacing;
      ensureStyle();
      list.setAttribute(SORTED_ATTR, "true");
      sortedList = list;
    }

    const ranked = Array.from(list.children)
      .map((el, index) => ({ el: el as HTMLElement, index, mpd: getItemMpd(el) }))
      .sort((a, b) => b.mpd - a.mpd || a.index - b.index);

    ranked.forEach(({ el }, rank) => {
      if (el.style.order !== String(rank)) el.style.order = String(rank);
    });
  };

  const startResync = () => {
    if (resyncTimer !== null) return;
    // React resets sort bar buttons when it re-renders
    resyncTimer = setInterval(() => apply(), RESYNC_INTERVAL_MS);
  };

  const stopResync = () => {
    if (resyncTimer !== null) {
      clearInterval(resyncTimer);
      resyncTimer = null;
    }
  };

  const apply = () => {
    if (disposed) return;
    const sortBar = getSortBar();
    if (sortBar) ensureSortBarButton(sortBar);

    if (!active) {
      if (sortBar) updateSortBarState(sortBar, false);
      return;
    }

    if (sortBar) updateSortBarState(sortBar, true);

    applyOrder();
    startResync();
  };

  const deactivate = () => {
    active = false;
    setMpdSortPreferred(false);
    stopResync();
    clearOrder();
    const sortBar = getSortBar();
    if (sortBar) updateSortBarState(sortBar, false);
  };

  const onSortClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const mpdBtn = target.closest<HTMLElement>(`#${SORT_BUTTON_ID}`);
    if (mpdBtn) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      active = true;
      setMpdSortPreferred(true);
      apply();
      return;
    }

    if (active) {
      const nativeBtn = target.closest<HTMLElement>(
        `${SORT_BAR_CONTAINER_SELECTOR} button, button[data-element-name^="search-sort-"]`
      );
      if (nativeBtn && !nativeBtn.hasAttribute("data-aa-mpd") && nativeBtn.id !== SORT_BUTTON_ID) {
        deactivate();
      }
    }
  };

  // Capture phase on window runs before React's listeners on its root container
  window.addEventListener("click", onSortClick, true);

  const teardown = () => {
    disposed = true;
    window.removeEventListener("click", onSortClick, true);
    stopResync();
    clearOrder();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(SORT_CONTAINER_ID)?.remove();
    document.getElementById(SORT_BUTTON_ID)?.remove();
    document.getElementById(SORT_BAR_STYLE_ID)?.remove();
    const sortBar = getSortBar();
    if (sortBar) sortBar.removeAttribute("data-aa-mpd-active");
  };

  return { apply, teardown };
}
