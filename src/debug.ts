// Developer Debug Tooling for AA Hotels MPD
// Development builds only (`npm run build:dev` or `npm run watch`): index.ts loads this module behind
// __AA_MPD_DEBUG__, so production bundles leave it out. Even then, the fixture export panel only
// mounts when the `showDebugButton` sync setting is true. There's no options page toggle; set it from
// the extension's service worker console with `chrome.storage.sync.set({ showDebugButton: true })`.
import {
  CapturedNetworkRecord,
  DEBUG_NETWORK_FLAG,
  DEBUG_RECORDS_REQUEST,
  DEBUG_RECORDS_RESPONSE,
} from './debug-recorder';

/** Turns network recording in the page's interceptor on or off for this and later page loads. */
export function setNetworkRecording(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(DEBUG_NETWORK_FLAG, '1');
    } else {
      localStorage.removeItem(DEBUG_NETWORK_FLAG);
    }
  } catch {
    // Storage may be unavailable
  }
}

/** Asks the interceptor, which runs in the page's world, for the responses it has recorded. */
export function requestCapturedNetworkRecords(timeoutMs = 2000): Promise<CapturedNetworkRecord[]> {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random()}`;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data?.type !== DEBUG_RECORDS_RESPONSE || event.data.id !== id) return;
      finish(Array.isArray(event.data.records) ? event.data.records : []);
    };
    const timer = setTimeout(() => finish([]), timeoutMs);
    const finish = (records: CapturedNetworkRecord[]) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(records);
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: DEBUG_RECORDS_REQUEST, id }, '*');
  });
}

export function getFixtureFilename(): string {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const isMapView = !!(
    (typeof document !== 'undefined' && (document.querySelector('[data-selenium*="map"]') || document.querySelector('.map-container'))) ||
    search.includes('view=map')
  );

  if (/\/hotel\/[^/]+\.html$/i.test(pathname) || pathname.includes('/accom/property') || pathname.includes('/property') || search.includes('propertyId=')) {
    return 'details-new.html';
  }
  if (pathname.startsWith('/search') || pathname === '/' || pathname === '') {
    return isMapView ? 'search-map-new.html' : 'search-new.html';
  }

  const cleanPath = pathname.replace(/^\/+|\/+$/g, '').replace(/[/\\]+/g, '-');
  return `${cleanPath || 'page'}-new.html`;
}

export function showDebugToast(message: string): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('aa-mpd-debug-toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'aa-mpd-debug-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '76px',
    right: '16px',
    backgroundColor: '#0f172a',
    color: '#38bdf8',
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '500',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
    zIndex: '9999999',
    transition: 'opacity 0.3s ease',
  });

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * Serializes the document with every inline <style> tag's live CSSOM rules written back as text.
 * The site's CSS-in-JS libraries (emotion/Chakra, styled-components) inject rules via
 * CSSStyleSheet.insertRule, which leaves the <style> tags empty in outerHTML, so a plain
 * outerHTML snapshot loses nearly all of the page's styling.
 *
 * It also turns anchors nested inside other anchors into <span>s. React can build nested <a>
 * elements (the site's hotel cards are links containing links), but the HTML parser can't
 * represent them, so re-parsing the snapshot would split each card apart.
 */
export function serializeDocumentWithStyles(doc: Document = document): string {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;

  clone.querySelectorAll('a a').forEach((inner) => {
    const span = doc.createElement('span');
    Array.from(inner.attributes).forEach((attr) => span.setAttribute(attr.name, attr.value));
    span.append(...Array.from(inner.childNodes));
    inner.replaceWith(span);
  });
  const liveStyles = Array.from(doc.documentElement.querySelectorAll('style'));
  const clonedStyles = Array.from(clone.querySelectorAll('style'));

  liveStyles.forEach((style, i) => {
    const target = clonedStyles[i];
    if (!target || !style.sheet) {
      return;
    }
    try {
      const rules = Array.from(style.sheet.cssRules, (rule) => rule.cssText);
      if (rules.length > 0) {
        target.textContent = rules.join('\n');
      }
    } catch {
      // Keep the original text if the sheet's rules are unreadable
    }
  });

  return '<!DOCTYPE html>\n' + clone.outerHTML;
}

export function exportCurrentDomFixture(): void {
  if (typeof document === 'undefined') return;
  const filename = getFixtureFilename();
  const html = serializeDocumentWithStyles();

  // 1. Trigger direct browser download
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[AA-Hotels-MPD] Failed to download fixture:', err);
  }

  // 2. Also copy to clipboard
  try {
    navigator.clipboard.writeText(html);
  } catch {
    // Clipboard write may require user focus - non-critical
  }

  showDebugToast(`Exported "${filename}" & copied to clipboard! (Drop in fixtures/)`);
}

export async function exportNetworkJsonFixture(): Promise<void> {
  const records = await requestCapturedNetworkRecords();
  if (records.length === 0) {
    showDebugToast('No network responses recorded yet. Reload the page to record from the start.');
    return;
  }
  const dataStr = JSON.stringify(records, null, 2);
  const filename = 'search-graphql.json';

  try {
    const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[AA-Hotels-MPD] Failed to download network fixture:', err);
  }

  try {
    navigator.clipboard.writeText(dataStr);
  } catch {}

  showDebugToast(`Exported "${filename}" (${records.length} records) & copied to clipboard!`);
}

export async function mountDebugButton(): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }

  if (document.getElementById('aa-mpd-debug-panel')) {
    return;
  }

  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) return;
    const { showDebugButton } = await chrome.storage.sync.get({ showDebugButton: false });
    setNetworkRecording(Boolean(showDebugButton));
    if (!showDebugButton) return;
  } catch {
    return;
  }

  // Another call may have mounted the panel while storage was being read
  if (document.getElementById('aa-mpd-debug-panel')) {
    return;
  }

  const panel = document.createElement('div');
  panel.id = 'aa-mpd-debug-panel';
  Object.assign(panel.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    display: 'flex',
    gap: '8px',
    zIndex: '9999998',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    padding: '6px 10px',
    borderRadius: '24px',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
  });

  // 1. Export DOM Fixture Button
  const domBtn = document.createElement('button');
  domBtn.title = 'Save live DOM snapshot as HTML test fixture';
  domBtn.innerHTML = '📸 <span>DOM Fixture</span>';
  Object.assign(domBtn.style, {
    background: 'transparent',
    color: '#ffffff',
    border: 'none',
    fontSize: '12px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: '600',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '12px',
  });
  domBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    exportCurrentDomFixture();
  });

  // 2. Export GraphQL / Network JSON Button
  const netBtn = document.createElement('button');
  netBtn.title = 'Save intercepted GraphQL / REST responses as JSON fixture';
  netBtn.innerHTML = '🌐 <span>Network JSON</span>';
  Object.assign(netBtn.style, {
    background: 'transparent',
    color: '#38bdf8',
    border: 'none',
    fontSize: '12px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: '600',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '12px',
  });
  netBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    exportNetworkJsonFixture().catch(console.error);
  });

  panel.appendChild(domBtn);
  panel.appendChild(netBtn);
  document.body.appendChild(panel);
}
