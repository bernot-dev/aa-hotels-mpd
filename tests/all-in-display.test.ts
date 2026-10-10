import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractHotelRatesFromPayload,
  extractRoomRatesFromPayload,
  getAllInTotal,
  getSitePriceTotals,
  type EnrichedHotelRate,
} from '../src/interceptor';
import { resolveAllInAmount, ingestRoomRates, clearRoomRates, ALL_IN_LABEL } from '../src/allin';
import { processCard } from '../src/cards';
import { updateMapPins } from '../src/map';
import { hotelDataRegistry, clearHotelMpdRegistry } from '../src/registry';

const usd = (amount: number) => ({ currency: 'USD', symbol: '&#36;', amount });

// Prices from the live Las Vegas search (The STRAT, 6 nights): the site shows $510, which is the room
// plus resort fees without taxes; the all-in total with taxes and every fee is $578.57.
const STRAT = {
  totalPrice: usd(210.65),
  grandTotalPublishedPriceInclusive: usd(238.79),
  grandTotalPublishedPriceInclusiveWithFees: usd(578.57),
  grandTotalPublishedPriceWithPropertyTaxAndCounterFees: usd(510.35),
};

describe('interceptor all-in totals', () => {
  it('uses the total with taxes and all fees as the all-in price', () => {
    expect(getAllInTotal(STRAT)).toBe(578.57);
  });

  it('falls back to the taxes-inclusive total when the fees-inclusive one is missing', () => {
    expect(getAllInTotal({ grandTotalPublishedPriceInclusive: usd(331.94) })).toBe(331.94);
  });

  it('lists the totals the site may display', () => {
    expect(getSitePriceTotals(STRAT)).toEqual([510.35, 210.65, 238.79]);
  });

  it('records all-in and site totals on hotel search results', () => {
    const [hotel] = extractHotelRatesFromPayload({
      checkInDate: '2026-10-04',
      checkOutDate: '2026-10-10',
      data: {
        search: {
          properties: [
            {
              propertyId: '94254',
              displayName: 'The STRAT',
              pricing: {
                displayPrice: { amount: 210.65 },
                inclusive: { amount: 578.57 },
              },
              ...STRAT,
              loyaltyOfferSummary: { offers: [{ earn: { points: 600 } }] },
            },
          ],
        },
      },
    });
    expect(hotel.allInPrice).toBe(578.57);
    expect(hotel.sitePriceTotals).toEqual([510.35, 210.65, 238.79]);
    expect(hotel.nights).toBe(6);
  });

  it('extracts details room rates and skips hotel search results', () => {
    const rooms = extractRoomRatesFromPayload([
      {
        id: 1,
        name: 'Bleu King',
        childrenRooms: [
          {
            rewards: 8600,
            numberOfNights: 6,
            totalPrice: usd(4162.83),
            grandTotalPublishedPriceInclusive: usd(4719.85),
            grandTotalPublishedPriceInclusiveWithFees: usd(4719.85),
            grandTotalPublishedPriceWithPropertyTaxAndCounterFees: usd(4162.83),
          },
        ],
      },
      { hotel: { id: 5 }, rewards: 100, ...STRAT },
    ]);
    expect(rooms).toEqual([
      { allInPrice: 4719.85, sitePriceTotals: [4162.83, 4719.85], rewards: 8600, nights: 6 },
    ]);
  });
});

describe('resolveAllInAmount', () => {
  const candidates = { allInPrice: 578.57, sitePriceTotals: [510.35, 210.65], nights: 6 };

  it('replaces a site total with the all-in total', () => {
    expect(resolveAllInAmount(510, candidates)).toBe(578.57);
    expect(resolveAllInAmount(211, candidates)).toBe(578.57);
  });

  it('leaves a price that already shows the all-in total (e.g. California), allowing for rounding', () => {
    expect(resolveAllInAmount(579, candidates)).toBeNull();
    expect(resolveAllInAmount(578, candidates)).toBeNull();
  });

  it('keeps per-night prices per night', () => {
    expect(resolveAllInAmount(85, candidates)).toBeCloseTo(578.57 / 6);
    expect(resolveAllInAmount(96, candidates)).toBeNull();
  });

  it('leaves prices it cannot identify', () => {
    expect(resolveAllInAmount(1234, candidates)).toBeNull();
  });
});

describe('all-in price display', () => {
  const hotel = (overrides: Partial<EnrichedHotelRate> = {}): EnrichedHotelRate => ({
    hotelId: '94254',
    hotelName: 'The STRAT',
    price: 578.57,
    basePrice: 210.65,
    allInPrice: 578.57,
    sitePriceTotals: [510.35, 210.65, 238.79],
    nightlyPrice: 0,
    fees: 0,
    baseMiles: 7300,
    tieredMiles: 7300,
    city: 'Las Vegas',
    state: 'NV',
    location: 'Las Vegas, NV',
    nights: 6,
    ...overrides,
  });

  const pricing = (price: string, label = 'includes fees', miles = 7300) => `
    <div data-selenium="points-max-promo-text">Earn ${miles.toLocaleString()} miles per stay</div>
    <div data-element-name="fpc-room-price" data-selenium="display-price">${price}</div>
    <div data-element-name="fpc-price-text" data-selenium="hotel-currency">Total (6 nights)</div><div>${label}</div>`;

  const searchCard = (price: string, label?: string) => {
    document.body.innerHTML = `
      <li class="PropertyCardItem" data-hotelid="94254" data-selenium="hotel-item">
        <div data-element-name="property-card">
          ${pricing(price, label)}
        </div>
      </li>`;
    return document.querySelector('[data-element-name="property-card"]')!;
  };

  const priceText = () => document.querySelector('[data-element-name="fpc-room-price"]')!.textContent;
  // innerHTML parsing moves the <div> note out of the <p>/<div>, so read the note with the text after it
  const note = () => {
    const p = document.querySelector('[data-element-name="fpc-price-text"]')!;
    return p.textContent! + (p.nextElementSibling?.textContent ?? '');
  };

  beforeEach(() => {
    clearHotelMpdRegistry();
    clearRoomRates();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the all-in total on search cards and relabels the fee note', () => {
    hotelDataRegistry.set('94254', hotel());
    const card = searchCard('$510');
    processCard(card, 6, false, true);

    expect(priceText()).toBe('$579');
    expect(note()).toBe(`Total (6 nights)${ALL_IN_LABEL}`);
    // MPD is computed from the all-in total: 7,300 / 578.57
    expect(card.querySelector<HTMLElement>('.aa-mpd-badge')!.dataset.rate).toBe('12.6');
  });

  it('relabels the fee note when it is nested inside pricing-text, as React renders it', () => {
    hotelDataRegistry.set('94254', hotel());
    const card = searchCard('$510');
    const pricingText = card.querySelector('[data-element-name="fpc-price-text"]')!;
    pricingText.appendChild(pricingText.nextElementSibling!);
    processCard(card, 6, false, true);
    expect(pricingText.textContent).toBe(`Total (6 nights)${ALL_IN_LABEL}`);
  });

  it('changes nothing when the site already shows the all-in total', () => {
    hotelDataRegistry.set('94254', hotel());
    const card = searchCard('$579', 'includes taxes & fees');
    const before = card.querySelector('[data-element-name="fpc-price-text"]')!.outerHTML;
    processCard(card, 6, false, true);

    expect(priceText()).toBe('$579');
    expect(card.querySelector('[data-element-name="fpc-price-text"]')!.outerHTML).toBe(before);
    expect(card.querySelector('[data-element-name="fpc-room-price"]')!.hasAttribute('data-aa-mpd-all-in')).toBe(false);
  });

  it('leaves prices alone when the pricing method is base price', () => {
    hotelDataRegistry.set('94254', hotel());
    const card = searchCard('$510');
    processCard(card, 6, false, false);
    expect(priceText()).toBe('$510');
    expect(note()).toBe('Total (6 nights)includes fees');
  });

  it('is stable across repeated passes and reapplies after the site resets the price', () => {
    hotelDataRegistry.set('94254', hotel());
    const card = searchCard('$510');
    processCard(card, 6, false, true);
    processCard(card, 6, false, true);
    expect(priceText()).toBe('$579');

    // React updates the same text node when it re-renders
    card.querySelector('[data-element-name="fpc-room-price"]')!.firstChild!.nodeValue = '$510';
    processCard(card, 6, false, true);
    expect(priceText()).toBe('$579');
    expect(note()).toBe(`Total (6 nights)${ALL_IN_LABEL}`);
  });

  it('keeps the currency symbol and formatting of the original price', () => {
    hotelDataRegistry.set('94254', hotel({ allInPrice: 4719.85, sitePriceTotals: [4162.83] }));
    searchCard('US$4,163');
    processCard(document.querySelector('[data-element-name="property-card"]')!, 6, false, true);
    expect(priceText()).toBe('US$4,720');
  });

  it('shows all-in totals on map pins', () => {
    hotelDataRegistry.set('94254', hotel());
    document.body.innerHTML = `
      <button data-selenium="propertyMarkerIcon-94254" id="propertyMarkerIcon-94254">
        <div class="propertyMarkerIcon-content"><span>$510</span></div>
      </button>`;
    updateMapPins(document.body, true);
    expect(document.querySelector('#propertyMarkerIcon-94254')!.textContent?.trim()).toBe('$579');
  });

  it('matches details room rates by price and member miles', () => {
    ingestRoomRates([
      { allInPrice: 4719.85, sitePriceTotals: [4162.83], rewards: 8600, nights: 6 },
      { allInPrice: 4887.43, sitePriceTotals: [4330.41], rewards: 14600, nights: 6 },
    ]);
    document.body.innerHTML = `<div class="MasterRoom" data-element-name="room-card" data-selenium="room-card">${pricing('$4,163', 'includes fees', 8600)}</div>`;
    processCard(document.querySelector('[data-element-name="room-card"]')!, 6, false, true);

    expect(priceText()).toBe('$4,720');
    expect(note()).toBe(`Total (6 nights)${ALL_IN_LABEL}`);
  });

  it('leaves a details rate alone when the match is ambiguous or missing', () => {
    ingestRoomRates([
      { allInPrice: 4719.85, sitePriceTotals: [4162.83], rewards: 8600, nights: 6 },
      { allInPrice: 4800, sitePriceTotals: [4162.83], rewards: 8600, nights: 6 },
    ]);
    document.body.innerHTML = `<div class="MasterRoom" data-element-name="room-card" data-selenium="room-card">${pricing('$4,163', 'includes fees', 8600)}</div>`;
    processCard(document.querySelector('[data-element-name="room-card"]')!, 6, false, true);
    expect(priceText()).toBe('$4,163');

    document.body.innerHTML = `<div class="MasterRoom" data-element-name="room-card" data-selenium="room-card">${pricing('$999', 'includes fees', 8600)}</div>`;
    processCard(document.querySelector('[data-element-name="room-card"]')!, 6, false, true);
    expect(priceText()).toBe('$999');
  });
});
