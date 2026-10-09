// "Most miles per dollar" sort for the search results list.
//
// The site's sort options (in [data-element-name="sort-bar-container"] or the older <select id="sort-by-dropdown">)
// are controlled by React, and their own options refetch the results. This option is handled entirely
// client-side: it stops the click/change event before React sees it, then reorders hotels with CSS `order`
// on the flex list (leaving DOM order, which React owns, intact). The choice persists across reloads until
// the user picks one of the site's own options.

export const MPD_SORT_VALUE = "aa-mpd";
export const MPD_SORT_LABEL = "Most miles per dollar";
export const MPD_SORT_STORAGE_KEY = "aa_hotels_mpd_sort";

export const SORT_BAR_CONTAINER_SELECTOR = '[data-element-name="sort-bar-container"]';
export const SORT_BUTTON_ID = "aa-mpd-sort-button";
export const SORT_CONTAINER_ID = "aa-mpd-sort-container";
export const SORT_BAR_STYLE_ID = "aa-mpd-sort-bar-style";

const SELECT_ID = "sort-by-dropdown";
const OPTION_ID = "aa-mpd-sort-option";
const STYLE_ID = "aa-mpd-sort-style";
const SELECT_STYLE_ID = "aa-mpd-select-style";
const SELECT_BUTTON_ID = "aa-mpd-select-button";
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

/** Chrome 135+ can render rich option content once a select opts in to `appearance: base-select`. */
function supportsCustomizableSelect(): boolean {
  try {
    return typeof CSS !== "undefined" && CSS.supports("appearance", "base-select");
  } catch {
    return false;
  }
}

/**
 * Switches the site's select to a customizable select so options (and the closed select, through
 * <selectedcontent>) can show the extension logo. Styled to match the site's own dropdown.
 */
function enableCustomizableSelect(select: HTMLSelectElement): void {
  if (!document.getElementById(SELECT_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = SELECT_STYLE_ID;
    const sel = `#${SELECT_ID}`;
    style.textContent = `
      ${sel}, ${sel}::picker(select) { appearance: base-select; }
      ${sel}::picker-icon { display: none; }
      ${sel}::picker(select) {
        background: #fff; border: 1px solid #c4c4c4; border-radius: 6px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15); padding: 4px 0;
      }
      ${sel} option { padding: 10px 16px; gap: 8px; align-items: center; }
      ${sel} option::checkmark { display: none; }
      ${sel} option:checked { font-weight: 600; }
      ${sel} option:hover, ${sel} option:focus-visible { background: #eef4fb; }
      ${sel} > button { display: contents; }
      ${sel} selectedcontent { display: inline-flex; align-items: center; gap: 8px; }
      ${sel} .aa-mpd-sort-logo { width: 20px; height: 20px; flex-shrink: 0; }
    `;
    document.head.appendChild(style);
  }
  if (!select.querySelector(`#${SELECT_BUTTON_ID}`)) {
    const button = document.createElement("button");
    button.id = SELECT_BUTTON_ID;
    button.setAttribute("data-aa-mpd", "true");
    button.appendChild(document.createElement("selectedcontent"));
    select.prepend(button);
  }
}

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

/** Hotel items are the list children holding a `hotel-card-<id>` element (or being one). */
export function findHotelList(): HTMLElement | null {
  const modernList = document.querySelector<HTMLElement>("ol.hotel-list-container, .hotel-list-container");
  if (modernList) return modernList;

  const container = document.querySelector('[data-testid="hotel-results-list-container"]');
  if (container) {
    const card = Array.from(container.querySelectorAll("[data-testid^='hotel-card-']")).find((el) =>
      /^hotel-card-\d+$/.test(el.getAttribute("data-testid") || "")
    );
    return (card?.parentElement as HTMLElement) ?? (container as HTMLElement);
  }

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
  /** Ensures the option exists, keeps the select/sort-bar showing it, and (re)orders hotels if active. */
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

  const getSelect = () => document.getElementById(SELECT_ID) as HTMLSelectElement | null;
  const getSortBar = () => document.querySelector<HTMLElement>(SORT_BAR_CONTAINER_SELECTOR);

  const ensureOption = (select: HTMLSelectElement) => {
    if (select.querySelector(`#${OPTION_ID}`)) return;
    const rich = supportsCustomizableSelect();
    if (rich) enableCustomizableSelect(select);

    const option = document.createElement("option");
    option.id = OPTION_ID;
    option.value = MPD_SORT_VALUE;
    option.textContent = MPD_SORT_LABEL;
    option.setAttribute("data-aa-mpd", "true");
    const logoUrl = getLogoUrl(48);
    if (rich && logoUrl) {
      // Customizable selects render option markup, so the extension logo can sit inline
      const logo = document.createElement("img");
      logo.src = logoUrl;
      logo.alt = "";
      logo.className = "aa-mpd-sort-logo";
      logo.title = "Added by AA Hotels MPD";
      option.append(" ", logo);
    }
    select.appendChild(option);
  };

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
    // React resets a controlled select's value or sort bar buttons when it re-renders
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
    const select = getSelect();
    if (select) ensureOption(select);

    const sortBar = getSortBar();
    if (sortBar) ensureSortBarButton(sortBar);

    if (!active) {
      if (sortBar) updateSortBarState(sortBar, false);
      return;
    }

    if (select && select.value !== MPD_SORT_VALUE) select.value = MPD_SORT_VALUE;
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

  const onSelectEvent = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLSelectElement) || target.id !== SELECT_ID) return;

    if (target.value === MPD_SORT_VALUE) {
      // Keep React from treating this as a site sort and refetching with an unknown value
      event.stopImmediatePropagation();
      if (event.type === "change") {
        active = true;
        setMpdSortPreferred(true);
        apply();
      }
    } else if (active && event.type === "change") {
      deactivate();
    }
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
  window.addEventListener("input", onSelectEvent, true);
  window.addEventListener("change", onSelectEvent, true);
  window.addEventListener("click", onSortClick, true);

  const teardown = () => {
    disposed = true;
    window.removeEventListener("input", onSelectEvent, true);
    window.removeEventListener("change", onSelectEvent, true);
    window.removeEventListener("click", onSortClick, true);
    stopResync();
    clearOrder();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(OPTION_ID)?.remove();
    document.getElementById(SELECT_BUTTON_ID)?.remove();
    document.getElementById(SELECT_STYLE_ID)?.remove();
    document.getElementById(SORT_CONTAINER_ID)?.remove();
    document.getElementById(SORT_BUTTON_ID)?.remove();
    document.getElementById(SORT_BAR_STYLE_ID)?.remove();
    const sortBar = getSortBar();
    if (sortBar) sortBar.removeAttribute("data-aa-mpd-active");
  };

  return { apply, teardown };
}
