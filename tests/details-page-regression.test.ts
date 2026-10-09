import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { processDetailsPage, setupRoomExpansion } from '../src/details';

type MockChrome = {
  storage: {
    sync: {
      get: ReturnType<typeof vi.fn>;
    };
  };
};

const getGlobalChrome = (): MockChrome | undefined =>
  (globalThis as unknown as { chrome?: MockChrome }).chrome;

const setGlobalChrome = (mock: MockChrome | undefined): void => {
  (globalThis as unknown as { chrome?: MockChrome }).chrome = mock;
};

describe('Details Page Presentation Regression Tests', () => {
  let parentContainer: HTMLDivElement;
  let roomGroupContainer: HTMLDivElement;
  let cleanupFn: (() => void) | null = null;

  beforeEach(() => {
    parentContainer = document.createElement('div');
    parentContainer.className = 'room-table-parent';
    roomGroupContainer = document.createElement('div');
    roomGroupContainer.id = 'property-room-grid-root';
    roomGroupContainer.setAttribute('data-selenium', 'room-grid');
    parentContainer.appendChild(roomGroupContainer);
    document.body.appendChild(parentContainer);
  });

  afterEach(() => {
    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }
    document.body.innerHTML = '';
  });

  const createRoomCard = (price: number, miles: number, isBoosted = false) => {
    const card = document.createElement('div');
    card.className = 'MasterRoom';
    card.setAttribute('data-selenium', 'master-room-card');
    card.setAttribute('data-element-name', 'room-card');
    card.innerHTML = `
      ${isBoosted ? '<div data-selenium="boost-tag">Earn 2,000 bonus miles!</div>' : ''}
      <div data-selenium="hotel-currency" class="PropertyCardPrice__Currency">Total (2 nights)</div>
      <div data-selenium="display-price" class="PropertyCardPrice__Value">$${price}</div>
      <div data-selenium="points-max-promo-text">Earn ${miles.toLocaleString()} miles per stay</div>
    `;
    return card;
  };

  it('mounts onto parent of room-group, injects summary banner, and decorates room cards', async () => {
    // Room 1: 1,000 miles / $200 = 5.0 miles/$
    // Room 2: 4,000 miles / $200 = 20.0 miles/$ (max)
    roomGroupContainer.appendChild(createRoomCard(200, 1000));
    roomGroupContainer.appendChild(createRoomCard(200, 4000));

    cleanupFn = await processDetailsPage(roomGroupContainer);

    await new Promise((r) => setTimeout(r, 60));

    const summary = document.getElementById('aa-mpd-details-summary');
    expect(summary).not.toBeNull();
    expect(summary?.style.display).toBe('block');
    expect(summary?.innerHTML).toContain('Best earn rate on this page: <b>20.0 miles/$</b>.');
    expect(summary?.nextElementSibling).toBe(roomGroupContainer);

    const badges = roomGroupContainer.querySelectorAll('.aa-mpd-badge');
    expect(badges.length).toBe(2);
    expect(badges[0].textContent).toBe(' (5.0\u00A0miles/$)');
    expect(badges[1].textContent).toBe(' (20.0\u00A0miles/$)');
  });

  it('teardown removes summary banner and disconnects observer', async () => {
    roomGroupContainer.appendChild(createRoomCard(200, 1000));
    cleanupFn = await processDetailsPage(roomGroupContainer);

    await new Promise((r) => setTimeout(r, 60));
    expect(document.getElementById('aa-mpd-details-summary')).not.toBeNull();

    cleanupFn();
    cleanupFn = null;

    expect(document.getElementById('aa-mpd-details-summary')).toBeNull();
  });

  it('runs against real details-guest.html fixture without crashing', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/details-guest.html');
    const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');
    const dom = new JSDOM(fixtureHtml);

    document.body.innerHTML = dom.window.document.body.innerHTML;

    const roomGroup = document.querySelector('#property-room-grid-root, div[data-selenium="room-grid"]');
    expect(roomGroup).not.toBeNull();

    const fixtureCleanup = await processDetailsPage(roomGroup!);
    await new Promise((r) => setTimeout(r, 80));

    const banner = document.getElementById('aa-mpd-details-summary');
    expect(banner).not.toBeNull();
    expect(banner?.style.display).toBe('block');
    expect(banner?.innerHTML).toContain('Best earn rate on this page:');

    const badges = document.querySelectorAll('.aa-mpd-badge');
    expect(badges.length).toBeGreaterThan(0);

    fixtureCleanup();
    expect(document.getElementById('aa-mpd-details-summary')).toBeNull();
  });

  it('runs against real details-authenticated.html fixture with 162 cards across 49 room groups', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/details-authenticated.html');
    if (!fs.existsSync(fixturePath)) {
      return;
    }
    const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');

    setGlobalChrome({
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({
            includeBonusMiles: false,
          }),
        },
      },
    });

    let dom = new JSDOM(fixtureHtml);
    document.body.innerHTML = dom.window.document.body.innerHTML;

    let roomGroup = document.querySelector('#property-room-grid-root, div[data-selenium="room-grid"]');
    if (!roomGroup) return;

    let fixtureCleanup = await processDetailsPage(roomGroup);
    await new Promise((r) => setTimeout(r, 80));

    let banner = document.getElementById('aa-mpd-details-summary');
    expect(banner).not.toBeNull();
    expect(banner?.style.display).toBe('block');
    expect(banner?.innerHTML).toContain('Best earn rate on this page:');

    fixtureCleanup();
  });

  it('does not re-toggle room rate buttons that are labeled "Show fewer room rates"', async () => {
    setGlobalChrome({
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({
            expandRoomRates: true,
          }),
        },
      },
    });

    let clickCount = 0;
    const toggle = document.createElement('button');
    toggle.setAttribute('data-selenium', 'room-see-more-toggle');
    toggle.textContent = 'Show fewer room rates';
    toggle.onclick = () => {
      clickCount++;
    };
    roomGroupContainer.appendChild(toggle);
    roomGroupContainer.appendChild(createRoomCard(200, 1000));

    cleanupFn = await processDetailsPage(roomGroupContainer);
    await new Promise((r) => setTimeout(r, 250));

    // Because it is already showing fewer (expanded), it must NOT be clicked
    expect(clickCount).toBe(0);
    expect(toggle.dataset.aaMpdExpanded).toBe('true');
  });
});

describe('Room Type & Rate Expansion Regression Tests', () => {
  let parentContainer: HTMLDivElement;
  let roomGroupContainer: HTMLDivElement;
  let cleanupFn: (() => void) | null = null;
  const originalChrome = getGlobalChrome();

  beforeEach(() => {
    parentContainer = document.createElement('div');
    parentContainer.className = 'room-table-parent';
    roomGroupContainer = document.createElement('div');
    roomGroupContainer.id = 'property-room-grid-root';
    roomGroupContainer.setAttribute('data-selenium', 'room-grid');
    parentContainer.appendChild(roomGroupContainer);
    document.body.appendChild(parentContainer);
  });

  afterEach(() => {
    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }
    document.body.innerHTML = '';
    setGlobalChrome(originalChrome);
  });

  const createRoomCard = (price: number, miles: number) => {
    const card = document.createElement('div');
    card.className = 'MasterRoom';
    card.setAttribute('data-selenium', 'master-room-card');
    card.setAttribute('data-element-name', 'room-card');
    card.innerHTML = `
      <div data-selenium="hotel-currency" class="PropertyCardPrice__Currency">Total (2 nights)</div>
      <div data-selenium="display-price" class="PropertyCardPrice__Value">$${price}</div>
      <div data-selenium="points-max-promo-text">Earn ${miles.toLocaleString()} miles per stay</div>
    `;
    return card;
  };

  it('expands all room types across more than 5 batches until completion', async () => {
    setGlobalChrome({
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({
            expandRoomTypes: true,
            expandRoomRates: false,
            includeBonusMiles: false,
          }),
        },
      },
    });

    roomGroupContainer.appendChild(createRoomCard(200, 1000));

    const seeMoreButton = document.createElement('button');
    seeMoreButton.setAttribute('data-selenium', 'rooms-see-more-button');
    seeMoreButton.textContent = 'Show 5 more rooms';
    parentContainer.appendChild(seeMoreButton);

    let batchCount = 0;
    const totalBatches = 8;

    seeMoreButton.onclick = () => {
      batchCount++;
      const newCard = createRoomCard(200, 1000 + batchCount * 500);
      roomGroupContainer.appendChild(newCard);

      if (batchCount >= totalBatches) {
        seeMoreButton.remove();
      } else {
        seeMoreButton.textContent = `Show 5 more rooms (batch ${batchCount})`;
      }
    };

    cleanupFn = await processDetailsPage(roomGroupContainer);

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (batchCount >= totalBatches && !document.querySelector('[data-selenium="rooms-see-more-button"]')) {
        break;
      }
    }

    await new Promise((r) => setTimeout(r, 60));

    expect(batchCount).toBe(8);
    expect(document.querySelector('[data-selenium="rooms-see-more-button"]')).toBeNull();
    const allCards = document.querySelectorAll('[data-selenium="master-room-card"]');
    expect(allCards.length).toBe(1 + totalBatches);

    const summary = document.getElementById('aa-mpd-details-summary');
    expect(summary?.innerHTML).toContain('25.0 miles/$');
  });

  it('detects and expands room types even if see-more button mounts after initial delay', async () => {
    setGlobalChrome({
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({
            expandRoomTypes: true,
            expandRoomRates: false,
          }),
        },
      },
    });

    roomGroupContainer.appendChild(createRoomCard(200, 1000));

    cleanupFn = await processDetailsPage(roomGroupContainer);
    await new Promise((r) => setTimeout(r, 150));

    let clicked = false;
    const seeMoreButton = document.createElement('button');
    seeMoreButton.setAttribute('data-selenium', 'rooms-see-more-button');
    seeMoreButton.textContent = 'Show 3 more rooms';
    seeMoreButton.onclick = () => {
      clicked = true;
      roomGroupContainer.appendChild(createRoomCard(200, 3000));
      seeMoreButton.remove();
    };
    parentContainer.appendChild(seeMoreButton);

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (clicked) break;
    }

    expect(clicked).toBe(true);
    expect(document.querySelectorAll('[data-selenium="master-room-card"]').length).toBe(2);
  });

  it('waits for busy/loading button to become enabled before clicking', async () => {
    let clickCount = 0;
    const button = document.createElement('button');
    button.setAttribute('data-selenium', 'rooms-see-more-button');
    button.disabled = true;
    button.onclick = () => {
      clickCount++;
    };
    parentContainer.appendChild(button);

    const controller = setupRoomExpansion({
      expandRoomTypes: true,
      expandRoomRates: false,
      pollIntervalMs: 50,
      postClickDelayMs: 50,
      waitTimeoutMs: 200,
    });

    await new Promise((r) => setTimeout(r, 120));
    expect(clickCount).toBe(0);

    button.disabled = false;

    await new Promise((r) => setTimeout(r, 120));
    expect(clickCount).toBe(1);

    controller.teardown();
  });

  it('stops expansion if button is clicked repeatedly without new content (safety guard)', async () => {
    let clickCount = 0;
    const button = document.createElement('button');
    button.setAttribute('data-selenium', 'rooms-see-more-button');
    button.textContent = 'Broken See More';
    button.onclick = () => {
      clickCount++;
    };
    parentContainer.appendChild(button);

    const controller = setupRoomExpansion({
      expandRoomTypes: true,
      expandRoomRates: false,
      maxConsecutiveNoChange: 3,
      pollIntervalMs: 20,
      postClickDelayMs: 20,
      waitTimeoutMs: 50,
    });

    await new Promise((r) => setTimeout(r, 350));
    expect(clickCount).toBeLessThanOrEqual(4);

    controller.teardown();
  });

  it('aborts active expansion on teardown and does not make further clicks', async () => {
    let clickCount = 0;
    const button = document.createElement('button');
    button.setAttribute('data-selenium', 'rooms-see-more-button');
    button.textContent = 'Show 5 more rooms';
    button.onclick = () => {
      clickCount++;
      roomGroupContainer.appendChild(createRoomCard(200, 1000));
    };
    parentContainer.appendChild(button);

    const controller = setupRoomExpansion({
      expandRoomTypes: true,
      expandRoomRates: false,
      pollIntervalMs: 40,
      postClickDelayMs: 40,
      waitTimeoutMs: 100,
    });

    await new Promise((r) => setTimeout(r, 120));
    const clicksBeforeTeardown = clickCount;
    expect(clicksBeforeTeardown).toBeGreaterThan(0);

    controller.teardown();

    await new Promise((r) => setTimeout(r, 200));
    expect(clickCount).toBe(clicksBeforeTeardown);
  });

  it('expands room rates on both initial and dynamically loaded room groups without toggling twice', async () => {
    setGlobalChrome({
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({
            expandRoomTypes: true,
            expandRoomRates: true,
          }),
        },
      },
    });

    const toggle1 = document.createElement('button');
    toggle1.setAttribute('data-selenium', 'room-see-more-toggle');
    toggle1.textContent = 'Show all room rates';
    let toggle1Clicks = 0;
    toggle1.onclick = () => {
      toggle1Clicks++;
    };
    roomGroupContainer.appendChild(toggle1);
    roomGroupContainer.appendChild(createRoomCard(200, 1000));

    const seeMoreButton = document.createElement('button');
    seeMoreButton.setAttribute('data-selenium', 'rooms-see-more-button');
    seeMoreButton.textContent = 'Show 5 more rooms';
    parentContainer.appendChild(seeMoreButton);

    let toggle2Clicks = 0;
    seeMoreButton.onclick = () => {
      const group2 = document.createElement('div');
      group2.id = 'property-room-grid-root';
      group2.setAttribute('data-selenium', 'room-grid');
      const toggle2 = document.createElement('button');
      toggle2.setAttribute('data-selenium', 'room-see-more-toggle');
      toggle2.textContent = 'Show all room rates';
      toggle2.onclick = () => {
        toggle2Clicks++;
      };
      group2.appendChild(toggle2);
      group2.appendChild(createRoomCard(200, 2000));
      parentContainer.appendChild(group2);

      seeMoreButton.remove();
    };

    cleanupFn = await processDetailsPage(roomGroupContainer);

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (toggle1Clicks === 1 && toggle2Clicks === 1) break;
    }

    expect(toggle1Clicks).toBe(1);
    expect(toggle2Clicks).toBe(1);
    expect(toggle1.dataset.aaMpdExpanded).toBe('true');
  });
});
