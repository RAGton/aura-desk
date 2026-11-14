import "@testing-library/jest-dom";
import "../lib/i18n";

// Node 22+ exposes a global `localStorage` that is `undefined` unless the
// runtime is started with `--localstorage-file`. Vitest copies the jsdom
// window's globals onto the test global, but it skips `localStorage`
// because the key already exists — so the app would see an undefined
// storage. Point it at the jsdom implementation, which is a working,
// in-memory store for the duration of the test.
if (typeof globalThis.localStorage === "undefined") {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window
    ?.localStorage;
  if (jsdomStorage) {
    Object.defineProperty(globalThis, "localStorage", {
      value: jsdomStorage,
      writable: true,
      configurable: true,
    });
  }
}

