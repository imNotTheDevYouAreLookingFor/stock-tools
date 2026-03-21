const TICKR_BASE = 'https://tickr.se';
const VAPID_PUBLIC_KEY = 'BB1NVVo0EzglS1fZVEC-YpcI2vGao_iWol28WdMKXcjOM2y62Ceiav4pDFbMqKp2SRPyL29Bu66o13M_JQx726U';
const STORAGE_KEY = 'avanzaOptimizerSettings';

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Tickr Tools] Installed');
  await maybeRegisterPush();
});

// ── Push registration ────────────────────────────────────────────────────────

async function maybeRegisterPush() {
  const enabled = await getTickrNotificationsSetting();
  if (!enabled) return;

  try {
    const existing = await self.registration.pushManager.getSubscription();
    if (existing) return; // already registered

    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    await registerWithTickr(subscription.toJSON());
  } catch (err) {
    console.warn('[Tickr Tools] Push registration failed:', err);
  }
}

async function registerWithTickr(subscription) {
  await fetch(`${TICKR_BASE}/api/extension/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription }),
  });
}

async function unregisterFromTickr() {
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return;

    await fetch(`${TICKR_BASE}/api/extension/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });

    await subscription.unsubscribe();
  } catch (err) {
    console.warn('[Tickr Tools] Push unregister failed:', err);
  }
}

// ── Push events ──────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Tickr', {
        body: data.body || '',
        icon: 'icons/icon128.png',
        badge: 'icons/icon16.png',
        data: { url: data.data?.url || 'https://tickr.se' },
      })
    );
  } catch (err) {
    console.warn('[Tickr Tools] Push parse error:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || 'https://tickr.se';
  event.waitUntil(clients.openWindow(url));
});

// ── Message from popup ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TICKR_NOTIFICATIONS_CHANGED') {
    if (message.enabled) {
      maybeRegisterPush();
    } else {
      unregisterFromTickr();
    }
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getTickrNotificationsSetting() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const settings = result[STORAGE_KEY] || {};
      resolve(settings.tickrNotifications !== false); // default true
    });
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}
