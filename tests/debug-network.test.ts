// The debug panel's "Network JSON" export (development builds): the MAIN world interceptor records inspected responses
// while the localStorage flag is set, and the content script's panel reads them over postMessage.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { setNetworkRecorder, wrapFetch } from '../src/interceptor';
import {
  DEBUG_NETWORK_FLAG,
  MAX_DEBUG_RECORDS,
  clearDebugNetworkRecords,
  getDebugNetworkRecords,
  handleDebugRecordsRequest,
  installNetworkRecorder,
} from '../src/debug-recorder';
import { requestCapturedNetworkRecords, setNetworkRecording } from '../src/debug';

const searchCall = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../fixtures/search-graphql-guest.json'), 'utf-8')
);
const SEARCH_URL = 'https://search.aadvantagehotels.com/graphql/search';

const fetchSearch = async () => {
  const wrapped = wrapFetch((async () => new Response(JSON.stringify(searchCall.response))) as unknown as typeof fetch);
  const response = await wrapped(SEARCH_URL, { method: 'POST', body: JSON.stringify(searchCall.request) });
  return response.json();
};

describe('debug network recording', () => {
  beforeEach(() => {
    // Done by interceptor-main.ts in development builds
    installNetworkRecorder();
    clearDebugNetworkRecords();
    localStorage.removeItem(DEBUG_NETWORK_FLAG);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setNetworkRecorder(null);
    window.removeEventListener('message', handleDebugRecordsRequest);
    localStorage.removeItem(DEBUG_NETWORK_FLAG);
  });

  it('records nothing unless the debug panel turned recording on', async () => {
    await fetchSearch();
    expect(getDebugNetworkRecords()).toEqual([]);
  });

  it('records the request and response the way the test fixtures store them', async () => {
    setNetworkRecording(true);
    await fetchSearch();

    const [record] = getDebugNetworkRecords();
    expect(record.url).toBe(SEARCH_URL);
    expect(record.method).toBe('FETCH');
    expect(record.request).toEqual(searchCall.request);
    expect(record.response).toEqual(searchCall.response);
  });

  it(`keeps only the latest ${MAX_DEBUG_RECORDS} responses`, async () => {
    setNetworkRecording(true);
    for (let i = 0; i < MAX_DEBUG_RECORDS + 5; i++) await fetchSearch();
    expect(getDebugNetworkRecords()).toHaveLength(MAX_DEBUG_RECORDS);
  });

  it('stops recording when the panel turns it off', async () => {
    setNetworkRecording(true);
    setNetworkRecording(false);
    expect(localStorage.getItem(DEBUG_NETWORK_FLAG)).toBeNull();
    await fetchSearch();
    expect(getDebugNetworkRecords()).toEqual([]);
  });

  // jsdom leaves event.source null; Chrome sets it to the window, which both sides check
  const postFromThisWindow = () =>
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data, source: window })));
    });

  it('hands the records to the debug panel over postMessage', async () => {
    postFromThisWindow();
    setNetworkRecording(true);
    await fetchSearch();

    const records = await requestCapturedNetworkRecords();
    expect(records).toHaveLength(1);
    expect(records[0].response).toEqual(searchCall.response);
  });

  it('ignores record requests from other windows', () => {
    const post = vi.spyOn(window, 'postMessage');
    handleDebugRecordsRequest(
      new MessageEvent('message', { data: { type: 'AA_HOTELS_MPD_DEBUG_RECORDS_REQUEST', id: 'x' }, source: null })
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('resolves empty when no interceptor answers', async () => {
    expect(await requestCapturedNetworkRecords(50)).toEqual([]);
  });
});
