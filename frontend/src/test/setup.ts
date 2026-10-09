import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// Waits (waitFor, findBy*) get 5 s, not Testing Library's 1 s. A wait on an
// asynchronous render (a lazy component, a fetched list) settles within a few
// hundred ms on an idle machine, but inside the full parallel suite, or with
// the machine busy elsewhere, the same waits were measured past 1 s and failed
// tests that pass on their own. No test relies on a wait timing out, so the
// only cost is that a wait that really fails takes 5 s to say so.
configure({ asyncUtilTimeout: 5000 });

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserver;

// Several components call matchMedia at import time for responsive detection.
// Use a configurable descriptor so individual tests can override the stub.
if (typeof globalThis.matchMedia === 'undefined') {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
