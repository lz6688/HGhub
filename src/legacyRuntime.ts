/** Runtime shims for Web APIs used by the app but missing in older Android WebViews.
 * Keep this dependency-free and import it before the rest of the application.
 */
if (!("globalThis" in window)) {
  Object.defineProperty(window, "globalThis", { value: window, configurable: true, writable: true });
}

// crypto.randomUUID requires Chromium 92+ and a secure context.
if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true, writable: true,
    value(): `${string}-${string}-${string}-${string}-${string}` {
      const bytes = new Uint8Array(16);
      if (typeof crypto.getRandomValues === "function") {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    },
  });
}

if (!Object.fromEntries) {
  Object.defineProperty(Object, "fromEntries", {
    configurable: true, writable: true,
    value(entries: Iterable<readonly [PropertyKey, unknown]>) {
      const result = {};
      for (const [key, value] of entries) {
        Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
      }
      return result;
    },
  });
}

if (!Promise.allSettled) {
  Object.defineProperty(Promise, "allSettled", {
    configurable: true, writable: true,
    value<T>(values: Iterable<T | PromiseLike<T>>) {
      return Promise.all(Array.from(values, value => Promise.resolve(value).then(
        resolved => ({ status: "fulfilled" as const, value: resolved }),
        reason => ({ status: "rejected" as const, reason }),
      )));
    },
  });
}

if (!Array.prototype.flat) {
  Object.defineProperty(Array.prototype, "flat", {
    configurable: true, writable: true,
    value(this: unknown[], depth = 1) {
      const output: unknown[] = [];
      const append = (items: unknown[], remaining: number) => {
        for (let index = 0; index < items.length; index++) {
          if (!(index in items)) continue;
          const item = items[index];
          if (remaining > 0 && Array.isArray(item)) append(item, remaining - 1);
          else output.push(item);
        }
      };
      append(this, Math.max(0, Math.trunc(Number(depth)) || 0));
      return output;
    },
  });
}

if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, "flatMap", {
    configurable: true, writable: true,
    value(this: unknown[], callback: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
      return Array.prototype.map.call(this, callback, thisArg).flat();
    },
  });
}

if (!window.queueMicrotask) {
  window.queueMicrotask = callback => {
    Promise.resolve().then(callback).catch(error => setTimeout(() => { throw error; }, 0));
  };
}

if (typeof HTMLElement !== "undefined" && !("inert" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute("inert"); },
    set(this: HTMLElement, value: boolean) {
      if (value) this.setAttribute("inert", "");
      else this.removeAttribute("inert");
    },
  });
}

if (!window.ResizeObserver) {
  class LegacyResizeObserver {
    private elements = new Map<Element, { width: number; height: number }>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (this.elements.has(target)) return;
      this.elements.set(target, { width: -1, height: -1 });
      if (!this.timer) this.timer = setTimeout(this.measure, 0);
    }
    unobserve(target: Element) {
      this.elements.delete(target);
      if (!this.elements.size) this.disconnect();
    }
    disconnect() {
      clearTimeout(this.timer); this.timer = undefined;
      this.elements.clear();
    }
    private measure = () => {
      this.timer = undefined;
      if (!this.elements.size) return;
      if (document.visibilityState !== "hidden") {
        const entries: ResizeObserverEntry[] = [];
        this.elements.forEach((previous, target) => {
          const rect = target.getBoundingClientRect();
          if (rect.width === previous.width && rect.height === previous.height) return;
          this.elements.set(target, { width: rect.width, height: rect.height });
          const size = [{ inlineSize: rect.width, blockSize: rect.height }];
          entries.push({ target, contentRect: rect, contentBoxSize: size, borderBoxSize: size, devicePixelContentBoxSize: size });
        });
        if (entries.length) {
          try { this.callback(entries, this as unknown as ResizeObserver); }
          catch (error) { setTimeout(() => { throw error; }, 0); }
        }
      }
      if (this.elements.size) this.timer = setTimeout(this.measure, 250);
    };
  }
  window.ResizeObserver = LegacyResizeObserver as unknown as typeof ResizeObserver;
}

function detectFlexGap() {
  const chrome = /(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent);
  if (chrome && Number(chrome[1]) >= 85) return;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;display:flex;flex-direction:column;row-gap:1px;visibility:hidden";
  probe.appendChild(document.createElement("div"));
  probe.appendChild(document.createElement("div"));
  document.body.appendChild(probe);
  if (probe.scrollHeight !== 1) document.documentElement.setAttribute("data-legacy-flex-gap", "");
  probe.remove();
}
if (document.body) detectFlexGap();
else document.addEventListener("DOMContentLoaded", detectFlexGap, { once: true });
