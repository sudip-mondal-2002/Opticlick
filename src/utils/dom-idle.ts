export function waitForDOMIdle(tabId: number, quietMs = 600, timeoutMs = 5000): Promise<void> {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: (q: number, t: number) => {
        return new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const resetTimer = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              observer.disconnect();
              resolve();
            }, q);
          };
          const observer = new MutationObserver(resetTimer);
          observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
          });
          resetTimer();
          setTimeout(() => {
            observer.disconnect();
            resolve();
          }, t);
        });
      },
      args: [quietMs, timeoutMs],
    })
    .then(() => {});
}
