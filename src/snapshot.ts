// Serializes a live page into self-contained HTML for offline test and screenshot fixtures.

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
