export interface WaitForElementOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const waitForElement = (
  elementSelector: string,
  options?: WaitForElementOptions
): Promise<Element> => {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(elementSelector);
    if (existing) {
      return resolve(existing);
    }

    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        return reject(new DOMException("Aborted", "AbortError"));
      }
      options.signal.addEventListener("abort", () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      });
    }

    if (options?.timeoutMs) {
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for element "${elementSelector}"`));
      }, options.timeoutMs);
    }

    observer = new MutationObserver(() => {
      const elem = document.querySelector(elementSelector);
      if (elem) {
        cleanup();
        resolve(elem);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
};
