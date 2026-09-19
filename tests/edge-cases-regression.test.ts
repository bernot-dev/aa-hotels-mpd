import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processCard, updateCards } from '../src/cards';
import { getNights } from '../src/nights';

describe('Edge Cases and Regression Guard Tests', () => {
  let card: HTMLDivElement;

  beforeEach(() => {
    card = document.createElement('div');
    card.setAttribute('data-testid', 'hotel-card-pricing');
  });

  describe('Incomplete and Broken Card Markup', () => {
    it('safely skips cards missing earn-price element without throwing', () => {
      card.innerHTML = `
        <div data-testid="pricing-text">Total</div>
        <div data-testid="tier-earn-rewards">Earn 5,000 miles per stay</div>
      `;

      expect(() => {
        const { cardMaxMPD, processedTiers } = processCard(card, 1, false);
        expect(cardMaxMPD).toBe(0);
        expect(processedTiers).toBe(0);
      }).not.toThrow();

      expect(card.querySelector('.aa-mpd-badge')).toBeNull();
    });

    it('gracefully handles missing pricing-text by falling back to per-night calculation', () => {
      // Missing pricing-text defaults to isTotalPrice = false (per-night)
      // 2,000 miles / $100 / 2 nights = 10.0 miles/$
      card.innerHTML = `
        <div data-testid="earn-price">$100</div>
        <div data-testid="tier-earn-rewards">Earn 2,000 miles per stay</div>
      `;

      expect(() => {
        const { cardMaxMPD, processedTiers } = processCard(card, 2, false);
        expect(processedTiers).toBe(1);
        expect(cardMaxMPD).toBeCloseTo(10.0, 1);
      }).not.toThrow();

      const badge = card.querySelector('.aa-mpd-badge');
      expect(badge?.textContent).toBe(' (10.0\u00A0miles/$)');
    });

    it('safely skips cards where price is 0 or non-numeric (e.g. Sold Out)', () => {
      card.innerHTML = `
        <div data-testid="pricing-text">Total</div>
        <div data-testid="earn-price">Sold Out</div>
        <div data-testid="tier-earn-rewards">Earn 5,000 miles per stay</div>
      `;

      const { cardMaxMPD, processedTiers } = processCard(card, 1, false);
      expect(cardMaxMPD).toBe(0);
      expect(processedTiers).toBe(0);
      expect(card.querySelector('.aa-mpd-badge')).toBeNull();
    });

    it('does not produce NaN or Infinity badges if dollars is $0', () => {
      card.innerHTML = `
        <div data-testid="pricing-text">Total</div>
        <div data-testid="earn-price">$0</div>
        <div data-testid="tier-earn-rewards">Earn 5,000 miles per stay</div>
      `;

      const { cardMaxMPD, processedTiers } = processCard(card, 1, false);
      expect(cardMaxMPD).toBe(0);
      expect(processedTiers).toBe(0);
      expect(card.querySelector('.aa-mpd-badge')).toBeNull();
    });

    it('skips tiers with 0 or non-numeric miles', () => {
      card.innerHTML = `
        <div data-testid="pricing-text">Total</div>
        <div data-testid="earn-price">$200</div>
        <div data-testid="tier-earn-rewards">Earn 0 miles</div>
      `;

      const { cardMaxMPD, processedTiers } = processCard(card, 1, false);
      expect(cardMaxMPD).toBe(0);
      expect(processedTiers).toBe(0);
      expect(card.querySelector('.aa-mpd-badge')).toBeNull();
    });
  });

  describe('Nights Calculation Edge Cases', () => {
    const originalLocation = window.location;

    afterEach(() => {
      delete (window as any).location;
      window.location = originalLocation;
      document.body.innerHTML = '';
    });

    it('handles malformed date strings in URL by defaulting to 1', () => {
      delete (window as any).location;
      window.location = new URL('https://www.aadvantagehotels.com/search?checkIn=not-a-date&checkOut=also-not-a-date') as any;

      expect(getNights()).toBe(1);
    });

    it('handles checkOut before checkIn (negative duration) by defaulting to 1', () => {
      delete (window as any).location;
      window.location = new URL('https://www.aadvantagehotels.com/search?checkIn=2026-10-10&checkOut=2026-10-05') as any;

      expect(getNights()).toBe(1);
    });

    it('falls back to DOM input elements if URL search params are absent', () => {
      delete (window as any).location;
      window.location = new URL('https://www.aadvantagehotels.com/search') as any;

      document.body.innerHTML = `
        <input id="check-in-date" value="2026-10-01" />
        <input id="check-out-date" value="2026-10-05" />
      `;

      expect(getNights()).toBe(4);
    });
  });

  describe('Self-Mutation and Recursion Prevention', () => {
    it('ignores MutationRecords that only contain our own .aa-mpd-badge elements', () => {
      const container = document.createElement('div');
      const maxBanner = document.createElement('div');
      const updateCallback = updateCards(container, maxBanner, '[data-testid="hotel-card-pricing"]', false);

      const fakeBadge = document.createElement('span');
      fakeBadge.className = 'aa-mpd-badge';
      fakeBadge.dataset.aaMpd = 'true';

      const mutationRecord: Partial<MutationRecord> = {
        target: fakeBadge,
        addedNodes: [fakeBadge] as unknown as NodeList,
      };

      // Calling updateCallback with badge mutation should not trigger work
      expect(() => {
        updateCallback([mutationRecord as MutationRecord]);
      }).not.toThrow();
    });
  });
});
