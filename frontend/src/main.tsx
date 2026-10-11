import './gateway/bootstrap';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import { App } from './App';
import { TapTooltipLayer } from './components/TapTooltipLayer';
import './index.css';
import './app-layers.css';
import { getSavedTheme, applyTheme, initFollowOSListener } from './utils/theme';
import { applyCrt } from './utils/crt';
import { applyFontScale, getSavedFontScale } from './utils/fontScale';
import { PushSubscriptionProvider } from './contexts/PushSubscriptionContext';
import { I18nProvider } from './i18n';
import { setCountryFlagFontActive } from './utils/countryFlagFont';
import { loadTileProxyConfig } from './map/engine/tileProxy';
import { getPopoutMode } from './popout/popoutMode';
import { applyPopoutSkin, getSavedPopoutSkin } from './popout/popoutSkin';
import { announceMainPresence } from './popout/mainPresence';
import { getGatewayContext } from './gateway/context';
import { GatewayApp } from './gateway/GatewayApp';

// Inject the bundled Twemoji flag font on browsers that support color emoji but
// not regional-indicator flags (Windows/Chromium). No-op on macOS/Linux/Firefox.
// Served locally from public/fonts, so it stays offline with no CDN dependency.
setCountryFlagFontActive(
  polyfillCountryFlagEmojis('Twemoji Country Flags', './fonts/TwemojiCountryFlags.woff2')
);

// Apply saved theme before first render
applyTheme(getSavedTheme());
// Stamp CRT phosphor/effect attributes (idempotent; applyTheme also does this).
applyCrt();
// Re-apply when the OS color-scheme preference changes, if on "Follow OS".
initFollowOSListener();
applyFontScale(getSavedFontScale());
// Multi-radio mode: the gateway serves this same build at /gateway/ as the
// radios page. No radio API exists there, so the app itself is not started.
const onRadiosPage = getGatewayContext()?.page === 'radios';
if (onRadiosPage) {
  // Nothing radio-specific to start.
} else if (getPopoutMode() !== null) {
  // Chat popup: paint its own skin over the saved theme before first render.
  applyPopoutSkin(getSavedPopoutSkin());
} else {
  // Lets an open chat popup know a main tab is handling sound and notifications.
  announceMainPresence();
}
if (!onRadiosPage) {
  // Learn early whether map tiles go through the backend tile cache, so the first
  // map mount already routes them (MapLibre reads it per request).
  void loadTileProxyConfig();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      {onRadiosPage ? (
        <GatewayApp />
      ) : (
        <PushSubscriptionProvider>
          <App />
        </PushSubscriptionProvider>
      )}
      {/* Tap tooltips for touch screens: on the radios page as well. */}
      <TapTooltipLayer />
    </I18nProvider>
  </StrictMode>
);

// Register service worker for Web Push (requires secure context)
if (!onRadiosPage && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.warn('Service worker registration failed:', err);
  });
}
