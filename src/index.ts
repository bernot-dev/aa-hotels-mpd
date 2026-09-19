import { initRouter, RouteInfo } from "./router";
import { waitForElement } from "./wait";
import { processDetailsPage } from "./details";
import { processSearchPage } from "./search";
import { mountDebugButton } from "./debug";

const SEARCH_SELECTOR = '[data-testid="hotel-results-list-container"]';
const DETAILS_SELECTOR = 'div[data-testid="room-group"]';

let activeTeardown: (() => void) | null = null;
let activeAbortController: AbortController | null = null;

async function handleRouteChange(routeInfo: RouteInfo) {
  // 1. Teardown active controller and cancel ongoing wait observers from previous route
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }

  if (activeTeardown) {
    try {
      activeTeardown();
    } catch (err) {
      console.error('[AA-Hotels-MPD] Error during controller teardown:', err);
    }
    activeTeardown = null;
  }

  // 2. Ensure debug button is mounted
  mountDebugButton().catch(console.error);

  // 3. Mount appropriate controller for the current route
  const currentAbort = new AbortController();
  activeAbortController = currentAbort;

  try {
    if (routeInfo.route === 'search') {
      const container = await waitForElement(SEARCH_SELECTOR, {
        signal: currentAbort.signal,
      });
      if (!currentAbort.signal.aborted) {
        activeTeardown = await processSearchPage(container);
      }
    } else if (routeInfo.route === 'details') {
      const container = await waitForElement(DETAILS_SELECTOR, {
        signal: currentAbort.signal,
      });
      if (!currentAbort.signal.aborted) {
        activeTeardown = await processDetailsPage(container);
      }
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Route changed while waiting for element - expected behavior
      return;
    }
    console.error(`[AA-Hotels-MPD] Error mounting ${routeInfo.route} page:`, err);
  }
}

// Start the SPA router
initRouter(handleRouteChange);
