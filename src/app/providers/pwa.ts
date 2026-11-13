import { Capacitor } from '@capacitor/core';

/** Register the offline service worker on the web only (native apps already bundle every file). */
export function registerServiceWorker() {
  if (Capacitor.isNativePlatform() || import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const update = registerSW({
        onNeedRefresh() {
          window.dispatchEvent(new CustomEvent('ks:update-available', { detail: () => update(true) }));
        },
      });
    })
    .catch(() => undefined);
}
