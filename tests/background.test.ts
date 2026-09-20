import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Extension Action & Options Page", () => {
  it("manifest.json defines action and options_page without popup", () => {
    const manifestPath = path.resolve(__dirname, "../manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.options_page).toBe("options.html");
    expect(manifest.action).toBeDefined();
    expect(manifest.action.default_title).toBe("AA Hotels MPD");
    // default_popup must NOT be defined so that chrome.action.onClicked fires
    expect(manifest.action.default_popup).toBeUndefined();
  });

  it("registers chrome.action.onClicked listener that opens options.html", async () => {
    let actionClickListener: (() => void) | undefined;
    const openOptionsPageMock = vi.fn();
    const tabsCreateMock = vi.fn();
    const getURLMock = vi.fn((file: string) => `chrome-extension://test-id/${file}`);

    (globalThis as any).chrome = {
      action: {
        onClicked: {
          addListener: vi.fn((fn: () => void) => {
            actionClickListener = fn;
          }),
        },
      },
      runtime: {
        openOptionsPage: openOptionsPageMock,
        getURL: getURLMock,
        onMessage: { addListener: vi.fn() },
      },
      tabs: {
        onUpdated: { addListener: vi.fn() },
        create: tabsCreateMock,
      },
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({}),
        },
      },
    };

    // Import background script to register listeners
    await import("../src/background");

    expect(actionClickListener).toBeDefined();
    actionClickListener!();
    expect(openOptionsPageMock).toHaveBeenCalledTimes(1);

    // Fallback path test if openOptionsPage is not available
    (globalThis as any).chrome.runtime.openOptionsPage = undefined;
    actionClickListener!();
    expect(tabsCreateMock).toHaveBeenCalledWith({
      url: "chrome-extension://test-id/options.html",
    });
  });
});
