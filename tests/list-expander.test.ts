import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type ListExpanderModule = typeof import("../src/list-expander");

class StubIntersectionObserver {
  constructor(public callback: IntersectionObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/**
 * A model of the live search page's list: 15 critical cards, a non-critical list that renders
 * after the first scroll/click and then waits on an in-view sentinel, and a list `onSearch`
 * that appends the next page. Cards carry React-style fibers pointing at the owning list.
 */
function createFakeSearchList(options: { extraPages: number }) {
  const ol = document.createElement("ol");
  ol.className = "hotel-list-container";
  document.body.appendChild(ol);

  const gateProps = { userInteracted: false, nonCriticalPropertyListProps: {} };
  const gateFiber = { memoizedProps: gateProps, return: null };
  let pagesLeft = options.extraPages;

  const makeList = () => {
    const props: any = { items: [] as unknown[], hasMoreProperties: true, onSearch: vi.fn() };
    const fiber = { memoizedProps: props, return: gateFiber };
    return { props, fiber };
  };

  const appendCards = (list: ReturnType<typeof makeList>, count: number) => {
    for (let i = 0; i < count; i++) {
      const li = document.createElement("li");
      li.className = "PropertyCard PropertyCardItem";
      (li as any).__reactFiber$test = { memoizedProps: { index: i }, return: list.fiber };
      list.props.items.push({});
      ol.appendChild(li);
    }
  };

  const critical = makeList();
  appendCards(critical, 15);

  const nonCritical = makeList();
  nonCritical.props.onSearch.mockImplementation((action: { type: string }) => {
    if (action.type !== "SEARCH_LOAD_EXTRA_PROPERTIES") return;
    nonCritical.props.hasMoreProperties = false;
    setTimeout(() => {
      appendCards(nonCritical, 45);
      pagesLeft--;
      nonCritical.props.hasMoreProperties = pagesLeft > 0;
    }, 10);
  });

  const onFirstInteraction = () => {
    window.removeEventListener("scroll", onFirstInteraction);
    gateProps.userInteracted = true;
    const sentinel = document.createElement("div");
    sentinel.setAttribute("data-testid", "non-critical-list-inview-sentinel");
    ol.appendChild(sentinel);
    const io = new window.IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      sentinel.remove();
      appendCards(nonCritical, 30);
    });
    io.observe(sentinel);
  };
  window.addEventListener("scroll", onFirstInteraction);

  return { ol, critical, nonCritical, gateProps };
}

const countCards = () => document.querySelectorAll("li.PropertyCardItem").length;

describe("list expander", () => {
  let mod: ListExpanderModule;
  let scrollToSpy: ReturnType<typeof vi.fn>;
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    document.body.innerHTML = "";
    (window as any).IntersectionObserver = StubIntersectionObserver;
    scrollToSpy = vi.fn();
    window.scrollTo = scrollToSpy as any;
    scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy as any;
    vi.resetModules();
    mod = await import("../src/list-expander");
    mod.trackSentinelObservers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("loads every card on the page without moving the viewport", async () => {
    const page = createFakeSearchList({ extraPages: 1 });
    expect(countCards()).toBe(15);

    const expander = mod.createListExpander({ pollIntervalMs: 5, stepTimeoutMs: 200 });
    expander.request();

    await vi.waitFor(() => expect(countCards()).toBe(90), { timeout: 2000 });
    expect(page.gateProps.userInteracted).toBe(true);
    expect(page.nonCritical.props.onSearch).toHaveBeenCalledTimes(1);
    expect(page.nonCritical.props.onSearch).toHaveBeenCalledWith({ type: "SEARCH_LOAD_EXTRA_PROPERTIES" });
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(0);
  });

  it("stops once the list reports no more properties", async () => {
    const page = createFakeSearchList({ extraPages: 2 });
    const expander = mod.createListExpander({ pollIntervalMs: 5, stepTimeoutMs: 200 });
    expander.request();

    await vi.waitFor(() => expect(countCards()).toBe(135), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(page.nonCritical.props.onSearch).toHaveBeenCalledTimes(2);
    expect(mod.expandListStep()).toBe(false);
  });

  it("only reports sentinel elements to their observers", () => {
    const callback = vi.fn();
    const io = new window.IntersectionObserver(callback);
    const other = document.createElement("div");
    other.setAttribute("data-testid", "lazy-load-component");
    document.body.appendChild(other);
    io.observe(other);
    expect(mod.fireSentinels()).toBe(0);

    const sentinel = document.createElement("div");
    sentinel.setAttribute("data-testid", "non-critical-list-inview-sentinel");
    document.body.appendChild(sentinel);
    io.observe(sentinel);
    expect(mod.fireSentinels()).toBe(1);
    expect(callback).toHaveBeenCalledWith(
      [expect.objectContaining({ target: sentinel, isIntersecting: true })],
      io
    );

    sentinel.remove();
    expect(mod.fireSentinels()).toBe(0);
  });

  it("does nothing on pages without a recognizable list", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    expect(mod.expandListStep()).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it("starts expanding when the content script asks for it", async () => {
    createFakeSearchList({ extraPages: 0 });
    mod.initListExpander();
    // jsdom's postMessage leaves `source` null; Chrome sets it to the page window
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: mod.EXPAND_LIST_MESSAGE }, source: window })
    );

    await vi.waitFor(() => expect(countCards()).toBe(45), { timeout: 8000 });
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
