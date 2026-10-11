/* Service worker for PWA installability and Web Push notifications. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// No-op fetch handler - required for PWA installability criteria.
// We don't cache anything; the app always fetches from the network.
self.addEventListener("fetch", () => {});

// Multi-radio mode: every radio is its own workspace under /r/<key>/ with its
// own service worker, and the gateway that lists the radios sits two levels up.
function radioKeyOfScope() {
  const match = /\/r\/([^/]+)\/$/.exec(new URL(self.registration.scope).pathname);
  return match ? match[1] : null;
}

// The name of this worker's radio, or null in single-radio mode, with only one
// radio, or when the gateway cannot be asked. Never delays a notification by
// more than the timeout and never prevents it.
async function radioLabel() {
  const key = radioKeyOfScope();
  if (!key) return null;
  try {
    const response = await fetch(new URL("../../gateway/api/radios", self.registration.scope), {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const radios = await response.json();
    if (!Array.isArray(radios) || radios.length < 2) return null;
    const radio = radios.find((entry) => entry && entry.url_key === key);
    return radio && typeof radio.name === "string" ? radio.name : null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "New message", body: event.data?.text() || "" };
  }

  const title = data.title || "New message";
  const options = {
    body: data.body || "",
    icon: "./favicon-256x256.png",
    badge: "./favicon-96x96.png",
    // Notification tags are shared by every page of one origin. Without the
    // scope, two radios replace each other's notification for the same channel.
    tag: `${self.registration.scope}|${data.tag || "meshcore-push"}`,
    data: { url_hash: data.url_hash || "" },
  };

  event.waitUntil(
    radioLabel().then((label) =>
      self.registration.showNotification(label ? `[${label}] ${title}` : title, options)
    )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlHash = event.notification.data?.url_hash || "";
  // Use the SW registration scope as the base URL so subpath deployments
  // (e.g. archworks.co/meshcore/) navigate correctly.
  const base = self.registration.scope;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windowClients) => {
        // Focus an existing tab if one is open
        for (const client of windowClients) {
          if (client.url.startsWith(base)) {
            await client.focus();
            if (urlHash) {
              await client.navigate(base + urlHash);
            }
            return;
          }
        }
        // Otherwise open a new tab
        return clients.openWindow(base + (urlHash || ""));
      })
  );
});
