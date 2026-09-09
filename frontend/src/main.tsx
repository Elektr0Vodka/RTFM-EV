import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import { App } from './App';
import './index.css';
import './themes.css';
import './styles.css';
import { getSavedTheme, applyTheme, initFollowOSListener } from './utils/theme';
import { applyFontScale, getSavedFontScale } from './utils/fontScale';
import { PushSubscriptionProvider } from './contexts/PushSubscriptionContext';

// Inject the bundled Twemoji flag font on browsers that support color emoji but
// not regional-indicator flags (Windows/Chromium). No-op on macOS/Linux/Firefox.
// Served locally from public/fonts, so it stays offline with no CDN dependency.
polyfillCountryFlagEmojis('Twemoji Country Flags', './fonts/TwemojiCountryFlags.woff2');

// Apply saved theme before first render
applyTheme(getSavedTheme());
// Re-apply when the OS color-scheme preference changes, if on "Follow OS".
initFollowOSListener();
applyFontScale(getSavedFontScale());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PushSubscriptionProvider>
      <App />
    </PushSubscriptionProvider>
  </StrictMode>
);

// Register service worker for Web Push (requires secure context)
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.warn('Service worker registration failed:', err);
  });
}
