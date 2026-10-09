// SPA Route Monitor and Lifecycle Dispatcher

export type RouteType = 'search' | 'details' | 'other';

export interface RouteInfo {
  route: RouteType;
  url: string;
}

export type RouteChangeCallback = (info: RouteInfo, prevInfo: RouteInfo | null) => void;

let lastUrl = '';
let lastRoute: RouteType = 'other';
const listeners: RouteChangeCallback[] = [];
let isInitialized = false;

export function isSensitiveCheckoutPage(urlStr: string = typeof window !== 'undefined' ? window.location.href : ''): boolean {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://search.aadvantagehotels.com';
    const url = new URL(urlStr, origin);
    const path = url.pathname.toLowerCase();
    return (
      path.includes('/checkout') ||
      path.includes('/payment') ||
      path.includes('/book') ||
      path.includes('/booking')
    );
  } catch {
    const lower = (urlStr || '').toLowerCase();
    return (
      lower.includes('/checkout') ||
      lower.includes('/payment') ||
      lower.includes('/book') ||
      lower.includes('/booking')
    );
  }
}

export function getRouteType(urlStr: string = typeof window !== 'undefined' ? window.location.href : ''): RouteType {
  try {
    if (isSensitiveCheckoutPage(urlStr)) {
      return 'other';
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://search.aadvantagehotels.com';
    const url = new URL(urlStr, origin);

    // Property details routes on search.aadvantagehotels.com
    // e.g. /la-quinta-inn-dallas-uptown_3/hotel/dallas-tx-us.html
    if (
      /\/hotel\/[^/]+\.html$/i.test(url.pathname) ||
      url.pathname.includes('/accom/property') ||
      url.pathname.includes('/property') ||
      url.searchParams.has('propertyId') ||
      url.searchParams.has('hotelId')
    ) {
      return 'details';
    }

    // Search page routes on search.aadvantagehotels.com
    if (
      url.pathname.startsWith('/search') ||
      url.pathname === '/' ||
      url.pathname === '' ||
      url.searchParams.has('destination') ||
      url.searchParams.has('city')
    ) {
      return 'search';
    }

    return 'other';
  } catch {
    return 'other';
  }
}

function handleUrlChange(newUrl: string = window.location.href) {
  if (newUrl === lastUrl) {
    return;
  }

  const prevInfo: RouteInfo | null = lastUrl
    ? { route: lastRoute, url: lastUrl }
    : null;

  const currentRoute = getRouteType(newUrl);
  lastUrl = newUrl;
  lastRoute = currentRoute;

  const currentInfo: RouteInfo = { route: currentRoute, url: newUrl };

  for (const listener of listeners) {
    try {
      listener(currentInfo, prevInfo);
    } catch (err) {
      console.error('[AA-Hotels-MPD] Error in route listener:', err);
    }
  }
}

export function initRouter(callback: RouteChangeCallback): () => void {
  listeners.push(callback);

  if (!isInitialized) {
    isInitialized = true;
    lastUrl = window.location.href;
    lastRoute = getRouteType(lastUrl);

    // 1. Intercept History API (pushState & replaceState)
    const wrapHistoryMethod = (method: 'pushState' | 'replaceState') => {
      const original = history[method];
      history[method] = function (...args: Parameters<typeof original>) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('locationchange'));
        return result;
      };
    };

    try {
      wrapHistoryMethod('pushState');
      wrapHistoryMethod('replaceState');
    } catch (e) {
      console.warn('[AA-Hotels-MPD] Unable to patch history API:', e);
    }

    // 2. Listen to browser navigation events
    window.addEventListener('popstate', () => handleUrlChange());
    window.addEventListener('hashchange', () => handleUrlChange());
    window.addEventListener('locationchange', () => handleUrlChange());

    // 3. Listen to messages from background service worker
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
        if (message?.type === 'SPA_NAVIGATED') {
          handleUrlChange(message.url || window.location.href);
        }
        return undefined;
      });
    }
  }

  // Trigger once for current initial page
  try {
    callback({ route: lastRoute, url: lastUrl }, null);
  } catch (err) {
    console.error('[AA-Hotels-MPD] Error in initial route call:', err);
  }

  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) {
      listeners.splice(idx, 1);
    }
  };
}
