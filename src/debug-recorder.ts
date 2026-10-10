// Debug network capture for the debug panel's "Network JSON" export. Development builds only:
// interceptor-main.ts installs it behind __AA_MPD_DEBUG__, so production bundles leave it out.
//
// The interceptor runs in the page's world at document_start, before the content script can read
// extension settings, so the debug panel turns recording on through a localStorage flag (shared by
// both worlds) and reads the records back with postMessage.
import { setNetworkRecorder } from "./interceptor";

export const DEBUG_NETWORK_FLAG = "aa_mpd_debug_network";
export const DEBUG_RECORDS_REQUEST = "AA_HOTELS_MPD_DEBUG_RECORDS_REQUEST";
export const DEBUG_RECORDS_RESPONSE = "AA_HOTELS_MPD_DEBUG_RECORDS_RESPONSE";
export const MAX_DEBUG_RECORDS = 50;

/** One inspected response, shaped like the { request, response } test fixtures. */
export interface CapturedNetworkRecord {
  url: string;
  method: string;
  timestamp: number;
  request?: unknown;
  response: unknown;
}

const debugRecords: CapturedNetworkRecord[] = [];

function isDebugRecording(): boolean {
  try {
    return localStorage.getItem(DEBUG_NETWORK_FLAG) === "1";
  } catch {
    return false;
  }
}

export function recordDebugNetwork(url: string, method: string, response: unknown, requestBody?: unknown): void {
  if (!isDebugRecording()) return;
  let request = requestBody;
  if (typeof requestBody === "string") {
    try {
      request = JSON.parse(requestBody);
    } catch {
      // Keep the raw body
    }
  } else if (requestBody !== undefined && requestBody !== null && typeof requestBody === "object") {
    // FormData, Blob and other bodies don't survive postMessage as useful JSON
    request = undefined;
  }
  debugRecords.push({ url, method, timestamp: Date.now(), request, response });
  if (debugRecords.length > MAX_DEBUG_RECORDS) debugRecords.splice(0, debugRecords.length - MAX_DEBUG_RECORDS);
}

export function getDebugNetworkRecords(): CapturedNetworkRecord[] {
  return debugRecords.slice();
}

export function clearDebugNetworkRecords(): void {
  debugRecords.length = 0;
}

/** Answers the debug panel's requests for the recorded responses. */
export function handleDebugRecordsRequest(event: MessageEvent): void {
  if (event.source !== window || event.data?.type !== DEBUG_RECORDS_REQUEST) return;
  try {
    window.postMessage({ type: DEBUG_RECORDS_RESPONSE, id: event.data.id, records: debugRecords }, "*");
  } catch (err) {
    console.debug("[AA-Hotels-MPD] Failed to send debug network records:", err);
  }
}

export function installNetworkRecorder(): void {
  setNetworkRecorder(recordDebugNetwork);
  window.addEventListener("message", handleDebugRecordsRequest);
}
