// Search list expander running in MAIN world (document_start).
// Loads every hotel card on the current results page without moving the viewport.
//
// The Agoda search page gates its cards behind three viewport-driven triggers:
//   1. Cards after the first 15 render only once `userInteracted` flips, which happens on the
//      first window `scroll` or `click` event (no geometry check).
//   2. That non-critical list then waits for its IntersectionObserver sentinel
//      (`non-critical-list-inview-sentinel`) to intersect the viewport.
//   3. Further pages load from a document scroll handler gated on
//      `window.scrollY / document.body.clientHeight > .75`, which calls the list's
//      `onSearch({ type: "SEARCH_LOAD_EXTRA_PROPERTIES" })`.
// Each trigger is fired directly: a synthetic scroll event, the sentinel's observer callback,
// and the list's own onSearch prop.

export const EXPAND_LIST_MESSAGE = "AA_HOTELS_MPD_EXPAND_LIST";

const SENTINEL_TEST_ID = /inview-sentinel/i;
const LOAD_EXTRA_PROPERTIES = "SEARCH_LOAD_EXTRA_PROPERTIES";
const LIST_CARD_SELECTOR = "ol.hotel-list-container li.PropertyCardItem";

interface SentinelRegistration {
  el: Element;
  callback: IntersectionObserverCallback;
  observer: IntersectionObserver;
}

interface PropertyListProps {
  items: unknown[];
  hasMoreProperties?: boolean;
  isLoading?: boolean;
  onSearch: (action: { type: string }) => void;
}

interface Fiber {
  memoizedProps?: unknown;
  return?: Fiber | null;
}

type FiberProps = Record<string, unknown>;

const TRACKED = Symbol.for("aa-hotels-mpd.trackedIntersectionObserver");
const sentinels: SentinelRegistration[] = [];

const isSentinel = (el: Element): boolean =>
  SENTINEL_TEST_ID.test(el.getAttribute?.("data-testid") || "");

/** Wraps IntersectionObserver so the callbacks of list sentinels can be invoked on demand. */
export function trackSentinelObservers(): void {
  const NativeObserver = window.IntersectionObserver;
  if (typeof NativeObserver !== "function" || TRACKED in NativeObserver) return;

  class TrackedObserver extends NativeObserver {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      super(callback, options);
      const nativeObserve = this.observe.bind(this);
      this.observe = (el: Element) => {
        if (isSentinel(el)) sentinels.push({ el, callback, observer: this });
        nativeObserve(el);
      };
    }
  }
  Object.defineProperty(TrackedObserver, TRACKED, { value: true });
  window.IntersectionObserver = TrackedObserver;
}

/** Reports every connected sentinel to its observer as fully visible. Returns how many fired. */
export function fireSentinels(): number {
  let fired = 0;
  for (let i = sentinels.length - 1; i >= 0; i--) {
    const { el, callback, observer } = sentinels[i];
    if (!el.isConnected) {
      sentinels.splice(i, 1);
      continue;
    }
    const rect = el.getBoundingClientRect();
    const entry = {
      target: el,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: rect,
      intersectionRect: rect,
      rootBounds: new DOMRect(0, 0, window.innerWidth, window.innerHeight),
      time: performance.now(),
    } as IntersectionObserverEntry;
    try {
      callback([entry], observer);
      fired++;
    } catch (err) {
      console.debug("[AA-Hotels-MPD] Sentinel callback failed:", err);
    }
  }
  return fired;
}

/** Walks up the React fiber tree from a DOM node until `match` accepts a component's props. */
function findFiberProps<T>(node: Element | null, match: (props: FiberProps) => boolean): T | null {
  if (!node) return null;
  const fiberKey = Object.keys(node).find((key) => key.startsWith("__reactFiber$"));
  let fiber = fiberKey ? ((node as unknown as Record<string, Fiber | undefined>)[fiberKey] ?? null) : null;
  for (let depth = 0; fiber && depth < 80; depth++) {
    const props = fiber.memoizedProps;
    if (props && typeof props === "object" && match(props as FiberProps)) return props as T;
    fiber = fiber.return ?? null;
  }
  return null;
}

const lastListCard = (): Element | null => {
  const cards = document.querySelectorAll(LIST_CARD_SELECTOR);
  return cards.length > 0 ? cards[cards.length - 1] : null;
};

/** Whether the list still waits for its first user interaction before rendering cards 16+. */
function awaitingInteraction(): boolean {
  const props = findFiberProps<{ userInteracted?: boolean }>(
    lastListCard(),
    (p) => "userInteracted" in p && "nonCriticalPropertyListProps" in p
  );
  return props?.userInteracted === false;
}

/** The props of the list that owns the last rendered card, which loads the next page. */
function findPropertyList(): PropertyListProps | null {
  return findFiberProps<PropertyListProps>(
    lastListCard(),
    (p) => typeof p.onSearch === "function" && "hasMoreProperties" in p && Array.isArray(p.items)
  );
}

/**
 * Performs the next loading step, if any. Returns false once every card on the page is loaded
 * (or the list is not recognized), true when a step was taken and more cards are expected.
 */
export function expandListStep(): boolean {
  if (fireSentinels() > 0) return true;

  if (awaitingInteraction()) {
    window.dispatchEvent(new Event("scroll"));
    return true;
  }

  const list = findPropertyList();
  if (list?.hasMoreProperties && !list.isLoading) {
    list.onSearch({ type: LOAD_EXTRA_PROPERTIES });
    return true;
  }
  return false;
}

export interface ListExpanderOptions {
  maxSteps?: number;
  pollIntervalMs?: number;
  stepTimeoutMs?: number;
}

/** Repeats expansion steps, waiting for each to render new cards, until the page is complete. */
export function createListExpander(options: ListExpanderOptions = {}) {
  const { maxSteps = 30, pollIntervalMs = 250, stepTimeoutMs = 6000 } = options;
  let running = false;
  let rerunRequested = false;
  let steps = 0;

  const countCards = () => document.querySelectorAll(LIST_CARD_SELECTOR).length;

  const waitForNewCards = (before: number) =>
    new Promise<void>((resolve) => {
      const started = Date.now();
      const poll = () => {
        if (countCards() > before || sentinels.some((s) => s.el.isConnected)) return resolve();
        if (Date.now() - started >= stepTimeoutMs) return resolve();
        setTimeout(poll, pollIntervalMs);
      };
      setTimeout(poll, pollIntervalMs);
    });

  const run = async () => {
    running = true;
    try {
      do {
        rerunRequested = false;
        while (steps < maxSteps) {
          const before = countCards();
          if (!expandListStep()) break;
          steps++;
          await waitForNewCards(before);
        }
      } while (rerunRequested && steps < maxSteps);
    } finally {
      running = false;
    }
  };

  return {
    /** Starts expanding, or asks a running expansion to check again once it settles. */
    request(): void {
      if (running) {
        rerunRequested = true;
        return;
      }
      void run();
    },
    /** Resets the step budget, e.g. after a new search replaced the list. */
    reset(): void {
      steps = 0;
    },
  };
}

let isInitialized = false;

export function initListExpander(): void {
  if (isInitialized || typeof window === "undefined") return;
  isInitialized = true;

  trackSentinelObservers();
  const expander = createListExpander();
  let lastUrl = window.location.href;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== EXPAND_LIST_MESSAGE) return;
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      expander.reset();
    }
    expander.request();
  });
}
