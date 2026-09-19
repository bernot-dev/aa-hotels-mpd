import { describe, it, expect, beforeEach } from 'vitest';
import { processCard, extractNumber } from '../src/cards';

describe('MPD Calculation Regression Tests', () => {
  let card: HTMLDivElement;

  beforeEach(() => {
    card = document.createElement('div');
    card.setAttribute('data-testid', 'hotel-card-pricing');
  });

  const setupCard = (priceText: string, pricingTypeText: string, tierMilesText: string) => {
    card.innerHTML = `
      <div data-testid="pricing-text">${pricingTypeText}</div>
      <div data-testid="earn-price">${priceText}</div>
      <div data-testid="tier-earn-rewards">${tierMilesText}</div>
    `;
  };

  describe('Total Pricing Mode', () => {
    it('calculates miles / dollars when pricingText starts with "Total"', () => {
      // 2,000 miles / $200 total = 10.0 miles/$
      setupCard('$200', 'Total (2 nights)', 'Earn 2,000 miles per stay');
      const { cardMaxMPD, processedTiers } = processCard(card, 2, false);

      expect(processedTiers).toBe(1);
      expect(cardMaxMPD).toBeCloseTo(10.0, 1);

      const badge = card.querySelector('.aa-mpd-badge');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe(' (10.0\u00A0miles/$)');
      expect(badge?.getAttribute('data-aa-mpd')).toBe('true');
    });

    it('handles total pricing with commas in both price and miles', () => {
      // 12,500 miles / $1,250 total = 10.0 miles/$
      setupCard('$1,250', 'Total (5 nights)', 'Earn 12,500 miles per stay');
      const { cardMaxMPD } = processCard(card, 5, false);

      expect(cardMaxMPD).toBeCloseTo(10.0, 1);
      const badge = card.querySelector('.aa-mpd-badge');
      expect(badge?.textContent).toBe(' (10.0\u00A0miles/$)');
    });
  });

  describe('Per-Night Pricing Mode', () => {
    it('calculates miles / dollars / nights when pricingText is per-night', () => {
      // 3,000 miles / $100 per night / 3 nights = 10.0 miles/$
      setupCard('$100', 'per night', 'Earn 3,000 miles per stay');
      const { cardMaxMPD, processedTiers } = processCard(card, 3, false);

      expect(processedTiers).toBe(1);
      expect(cardMaxMPD).toBeCloseTo(10.0, 1);

      const badge = card.querySelector('.aa-mpd-badge');
      expect(badge?.textContent).toBe(' (10.0\u00A0miles/$)');
    });

    it('calculates correctly for a 1-night stay in per-night mode', () => {
      // 1,500 miles / $150 per night / 1 night = 10.0 miles/$
      setupCard('$150', 'per night', 'Earn 1,500 miles per stay');
      const { cardMaxMPD } = processCard(card, 1, false);

      expect(cardMaxMPD).toBeCloseTo(10.0, 1);
    });
  });

  describe('High MPD Styling Threshold', () => {
    it('applies bold green styling when MPD >= 20', () => {
      // 5,000 miles / $200 total = 25.0 miles/$ (> 20)
      setupCard('$200', 'Total', 'Earn 5,000 miles per stay');
      processCard(card, 1, false);

      const badge = card.querySelector<HTMLSpanElement>('.aa-mpd-badge')!;
      expect(badge.style.color).toBe('green');
      expect(badge.style.fontWeight).toBe('bold');
    });

    it('does not apply green styling when MPD < 20', () => {
      // 1,000 miles / $100 total = 10.0 miles/$ (< 20)
      setupCard('$100', 'Total', 'Earn 1,000 miles per stay');
      processCard(card, 1, false);

      const badge = card.querySelector<HTMLSpanElement>('.aa-mpd-badge')!;
      expect(badge.style.color).toBe('');
      expect(badge.style.fontWeight).toBe('');
    });
  });

  describe('Multiple Reward Tiers', () => {
    it('calculates MPD for each tier and returns the highest MPD', () => {
      card.innerHTML = `
        <div data-testid="pricing-text">Total</div>
        <div data-testid="earn-price">$200</div>
        <div data-testid="non-tier-earn-rewards">Earn 400 miles per stay</div>
        <div data-testid="tier-earn-rewards">Earn 5,000 miles per stay</div>
      `;

      const { cardMaxMPD, processedTiers } = processCard(card, 1, false);
      expect(processedTiers).toBe(2);
      expect(cardMaxMPD).toBeCloseTo(25.0, 1);

      const badges = card.querySelectorAll('.aa-mpd-badge');
      expect(badges.length).toBe(2);
      // Tier 1: 400 / 200 = 2.0 miles/$
      expect(badges[0].textContent).toBe(' (2.0\u00A0miles/$)');
      expect((badges[0] as HTMLElement).style.color).toBe('');
      // Tier 2: 5000 / 200 = 25.0 miles/$
      expect(badges[1].textContent).toBe(' (25.0\u00A0miles/$)');
      expect((badges[1] as HTMLElement).style.color).toBe('green');
    });
  });

  describe('Dynamic Price Updates (Idempotency & Re-calculation)', () => {
    it('updates badge text in-place when price changes without adding duplicate badges', () => {
      setupCard('$200', 'Total', 'Earn 2,000 miles per stay');
      processCard(card, 1, false);

      let badges = card.querySelectorAll('.aa-mpd-badge');
      expect(badges.length).toBe(1);
      expect(badges[0].textContent).toBe(' (10.0\u00A0miles/$)');

      // Price decreases to $100 (e.g. promo or currency toggle)
      card.querySelector('[data-testid="earn-price"]')!.textContent = '$100';

      const { cardMaxMPD } = processCard(card, 1, false);
      expect(cardMaxMPD).toBeCloseTo(20.0, 1);

      badges = card.querySelectorAll('.aa-mpd-badge');
      expect(badges.length).toBe(1); // Still exactly 1 badge
      expect(badges[0].textContent).toBe(' (20.0\u00A0miles/$)');
      expect((badges[0] as HTMLElement).style.color).toBe('green');
    });

    it('removes badges if card becomes a boost card and includeBonusMiles is false', () => {
      setupCard('$200', 'Total', 'Earn 2,000 miles per stay');
      processCard(card, 1, true);
      expect(card.querySelectorAll('.aa-mpd-badge').length).toBe(1);

      // Now card gains boost tag, and user turns off includeBonusMiles
      const boostTag = document.createElement('div');
      boostTag.setAttribute('data-testid', 'boost-tag-container');
      card.appendChild(boostTag);

      processCard(card, 1, false);
      expect(card.querySelectorAll('.aa-mpd-badge').length).toBe(0);
    });
  });
});
