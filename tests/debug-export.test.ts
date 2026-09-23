import { describe, it, expect, beforeEach } from 'vitest';
import { serializeDocumentWithStyles } from '../src/debug';

describe('serializeDocumentWithStyles', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('writes CSSOM-inserted rules into otherwise empty <style> tags', () => {
    const style = document.createElement('style');
    style.setAttribute('data-emotion', 'css');
    document.head.appendChild(style);
    style.sheet!.insertRule('.css-abc123 { color: red; }');
    document.body.innerHTML = '<div class="css-abc123">Hotel</div>';

    expect(document.documentElement.outerHTML).not.toContain('color: red');

    const html = serializeDocumentWithStyles();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toMatch(/<style data-emotion="css">\.css-abc123 \{\s*color: red;\s*\}<\/style>/);
    expect(html).toContain('<div class="css-abc123">Hotel</div>');
  });

  it('turns nested anchors into spans so the snapshot re-parses with the same structure', () => {
    const outer = document.createElement('a');
    outer.href = '/details?id=1';
    outer.className = 'card';
    const inner = document.createElement('a');
    inner.href = '/reviews';
    inner.className = 'reviews';
    inner.textContent = '9.1 Exceptional';
    outer.append('Hotel ', inner, ' $500');
    document.body.appendChild(outer);

    const html = serializeDocumentWithStyles();
    expect(html).toContain('<a href="/details?id=1" class="card">Hotel <span href="/reviews" class="reviews">9.1 Exceptional</span> $500</a>');

    const reparsed = new DOMParser().parseFromString(html, 'text/html');
    expect(reparsed.querySelector('a.card')?.textContent).toBe('Hotel 9.1 Exceptional $500');
    expect(document.querySelector('a.card a.reviews')).not.toBeNull();
  });

  it('preserves text-authored styles and does not mutate the live document', () => {
    document.head.innerHTML = '<style>.a { margin: 0; }</style><style data-styled="active"></style>';
    const styled = document.head.querySelectorAll('style')[1] as HTMLStyleElement;
    styled.sheet!.insertRule('.sc-x { display: flex; }');

    const html = serializeDocumentWithStyles();
    expect(html).toMatch(/\.a \{\s*margin: 0(px)?;\s*\}/);
    expect(html).toMatch(/<style data-styled="active">\.sc-x \{\s*display: flex;\s*\}<\/style>/);
    expect(styled.textContent).toBe('');
  });
});
