// "Most miles per dollar" sort for the search results list.
//
// The site's sort <select> is controlled by React, and its own options refetch the results. This
// option is handled entirely client-side: it stops the change event before React sees it, then
// reorders hotels with CSS `order` on the flex list (leaving DOM order, which React owns, intact).
// The choice persists across reloads until the user picks one of the site's own options.

export const MPD_SORT_VALUE = "aa-mpd";
export const MPD_SORT_LABEL = "Most miles per dollar";
export const MPD_SORT_STORAGE_KEY = "aa_hotels_mpd_sort";

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

function getLogoUrl(): string | null {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      return chrome.runtime.getURL("images/icon-48.png");
    }
  } catch {
    // Extension context may be invalidated after an update
  }
  return null;
}

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

/** Hotel items are the list children holding a `hotel-card-<id>` element (or being one). */
function findHotelList(): HTMLElement | null {
  const container = document.querySelector('[data-testid="hotel-results-list-container"]');
  if (!container) return null;
  const card = Array.from(container.querySelectorAll("[data-testid^='hotel-card-']")).find((el) =>
    /^hotel-card-\d+$/.test(el.getAttribute("data-testid") || "")
  );
  return card?.parentElement ?? null;
}

/** Best MPD shown in an item's badges, or -1 when it has none (sorted last). */
export function getItemMpd(item: Element): number {
  let best = -1;
  item.querySelectorAll<HTMLElement>(".aa-mpd-badge[data-rate]").forEach((badge) => {
    const rate = parseFloat(badge.dataset.rate || "");
    if (isFinite(rate) && rate > best) best = rate;
  });
  return best;
}

export interface MpdSortController {
  /** Ensures the option exists, keeps the select showing it, and (re)orders hotels if active. */
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

  const ensureOption = (select: HTMLSelectElement) => {
    if (select.querySelector(`#${OPTION_ID}`)) return;
    const rich = supportsCustomizableSelect();
    if (rich) enableCustomizableSelect(select);

    const option = document.createElement("option");
    option.id = OPTION_ID;
    option.value = MPD_SORT_VALUE;
    option.textContent = MPD_SORT_LABEL;
    option.setAttribute("data-aa-mpd", "true");
    const logoUrl = getLogoUrl();
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
    style.textContent = `[${SORTED_ATTR}] > * { margin-top: 0 !important; order: 100000; }`;
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
    // React resets a controlled select's value when it re-renders, which fires no DOM mutation
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
    if (!active) return;

    if (select && select.value !== MPD_SORT_VALUE) select.value = MPD_SORT_VALUE;
    applyOrder();
    startResync();
  };

  const deactivate = () => {
    active = false;
    setMpdSortPreferred(false);
    stopResync();
    clearOrder();
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

  // Capture phase on window runs before React's listeners on its root container
  window.addEventListener("input", onSelectEvent, true);
  window.addEventListener("change", onSelectEvent, true);

  const teardown = () => {
    disposed = true;
    window.removeEventListener("input", onSelectEvent, true);
    window.removeEventListener("change", onSelectEvent, true);
    stopResync();
    clearOrder();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(OPTION_ID)?.remove();
    document.getElementById(SELECT_BUTTON_ID)?.remove();
    document.getElementById(SELECT_STYLE_ID)?.remove();
  };

  return { apply, teardown };
}
