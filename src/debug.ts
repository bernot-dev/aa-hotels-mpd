// Debug tool to export page DOM as a test fixture for aa-hotels-mpd

export function getFixtureFilename(): string {
  const pathname = window.location.pathname;
  const isMapView = !!(
    document.querySelector('[data-testid*="map"]') ||
    document.querySelector('.map-container') ||
    window.location.search.includes('view=map')
  );

  if (pathname.startsWith('/search')) {
    return isMapView ? 'search-map-authenticated.html' : 'search-authenticated.html';
  }
  if (pathname.startsWith('/details')) {
    return 'details-authenticated.html';
  }
  if (pathname === '/' || pathname === '') {
    return 'home-authenticated.html';
  }

  const cleanPath = pathname.replace(/^\/+|\/+$/g, '').replace(/[/\\]+/g, '-');
  return `${cleanPath || 'page'}-authenticated.html`;
}

export function showDebugToast(message: string): void {
  const existing = document.getElementById('aa-mpd-debug-toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'aa-mpd-debug-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '64px',
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

export async function mountDebugButton(): Promise<void> {
  if (document.getElementById('aa-mpd-debug-btn')) {
    return;
  }

  let showButton = true;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      const res = await chrome.storage.sync.get(['showDebugButton']);
      if (typeof res.showDebugButton === 'boolean') {
        showButton = res.showDebugButton;
      }
    }
  } catch {
    // Default to true if storage is unreachable
  }

  if (!showButton) {
    return;
  }

  const btn = document.createElement('button');
  btn.id = 'aa-mpd-debug-btn';
  btn.title = 'Save DOM snapshot as test fixture for aa-hotels-mpd';
  btn.innerHTML = '📸 <span>Export Fixture</span>';

  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '20px',
    padding: '7px 14px',
    fontSize: '12px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontWeight: '600',
    cursor: 'pointer',
    zIndex: '9999998',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.backgroundColor = 'rgba(15, 23, 42, 1)';
    btn.style.transform = 'scale(1.05)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.backgroundColor = 'rgba(15, 23, 42, 0.85)';
    btn.style.transform = 'scale(1)';
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    exportCurrentDomFixture();
  });

  document.body.appendChild(btn);
}
