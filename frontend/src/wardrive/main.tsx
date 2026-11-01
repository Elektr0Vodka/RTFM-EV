import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../app-layers.css';
import '../accessibility.css';
import { bootWardriveTheme } from './theme';
import { WardriveApp } from './WardriveApp';
import { WardrivePageI18n } from './pageI18n';

bootWardriveTheme();

// Offline support: the worker (./sw.js, scope /wardrive/) caches the page and
// every file of its build. The first load happened before it was in control,
// so after each load it is asked to store this build.
async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
    const ready = await navigator.serviceWorker.ready;
    ready.active?.postMessage({ type: 'wardrive-precache' });
  } catch (e) {
    console.warn('Wardrive: service worker not registered', e);
  }
}

void registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WardrivePageI18n>
      <WardriveApp />
    </WardrivePageI18n>
  </StrictMode>
);
