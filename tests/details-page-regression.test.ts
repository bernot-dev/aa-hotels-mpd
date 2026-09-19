import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { processDetailsPage } from '../src/details';

describe('Details Page Presentation Regression Tests', () => {
  let parentContainer: HTMLDivElement;
  let roomGroupContainer: HTMLDivElement;
  let cleanupFn: (() => void) | null = null;

  beforeEach(() => {
    parentContainer = document.createElement('div');
    parentContainer.className = 'room-table-parent';
    roomGroupContainer = document.createElement('div');
    roomGroupContainer.setAttribute('data-testid', 'room-group');
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
    card.setAttribute('data-testid', 'room-card');
    card.innerHTML = `
      ${isBoosted ? '<div data-testid="boost-tag-container">Earn 2,000 bonus miles!</div>' : ''}
      <div data-testid="pricing-text">Total (2 nights)</div>
      <div data-testid="earn-price">$${price}</div>
      <div data-testid="tier-earn-rewards">Earn ${miles.toLocaleString()} miles per stay</div>
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
    expect(summary?.nextElementSibling).toBe(parentContainer);

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

    const roomGroup = document.querySelector('div[data-testid="room-group"]');
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
});
