(function () {
  'use strict';

  const STORAGE_KEY = 'avanzaOptimizerSettings';

  const DEFAULT_SETTINGS = {
    defaultClass: 'MINI',
    mode: 'automatic',
    resetAfterOrder: true,
    privacyMode: false,
    hideLogos: false,
    tickrNotifications: true,
  };

  async function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (result[STORAGE_KEY]) {
          resolve({ ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] });
        } else {
          resolve(DEFAULT_SETTINGS);
        }
      });
    });
  }

  async function saveSettings(settings) {
    await new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: settings }, resolve);
    });

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id && tabs[0].url?.includes('avanza.se')) {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: (key, value) => {
            localStorage.setItem(key, JSON.stringify(value));
            window.dispatchEvent(new CustomEvent('avanzaOptimizerSettingsChanged', { detail: value }));
          },
          args: [STORAGE_KEY, settings],
          world: 'MAIN'
        });
      }
    } catch (e) {
      console.warn('[AvanzaUtilityTools] Could not inject settings:', e);
    }
  }

  function showStatus() {
    const status = document.getElementById('status');
    status.classList.add('show');
    setTimeout(() => status.classList.remove('show'), 1500);
  }

  function updateUI(settings) {
    // Auto mode toggle
    document.getElementById('autoMode').checked = settings.mode === 'automatic';

    // Reset after order toggle
    document.getElementById('resetAfterOrder').checked = settings.resetAfterOrder;

    // Privacy mode toggle
    document.getElementById('privacyMode').checked = !!settings.privacyMode;

    // Hide logos toggle
    document.getElementById('hideLogos').checked = !!settings.hideLogos;

    // Class radio buttons
    const radios = document.querySelectorAll('input[name="defaultClass"]');
    radios.forEach(radio => {
      radio.checked = radio.value === settings.defaultClass;
    });

    // Tier tabs
    const isPB = settings.defaultClass.startsWith('PRIVATE_BANKING');
    document.querySelectorAll('.tier-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.tier === 'pb') === isPB);
    });
    document.getElementById('standard-classes').style.display = isPB ? 'none' : 'block';
    document.getElementById('pb-classes').style.display = isPB ? 'block' : 'none';
  }

  async function init() {
    const settings = await getSettings();
    updateUI(settings);

    // Auto mode toggle
    document.getElementById('autoMode').addEventListener('change', async (e) => {
      const currentSettings = await getSettings();
      const newSettings = { ...currentSettings, mode: e.target.checked ? 'automatic' : 'manual' };
      await saveSettings(newSettings);
      showStatus();
    });

    // Reset after order toggle
    document.getElementById('resetAfterOrder').addEventListener('change', async (e) => {
      const currentSettings = await getSettings();
      const newSettings = { ...currentSettings, resetAfterOrder: e.target.checked };
      await saveSettings(newSettings);
      showStatus();
    });

    // Tier buttons
    document.querySelectorAll('.tier-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const isPB = btn.dataset.tier === 'pb';
        document.querySelectorAll('.tier-btn').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        document.getElementById('standard-classes').style.display = isPB ? 'none' : 'block';
        document.getElementById('pb-classes').style.display = isPB ? 'block' : 'none';

        // Select first class of the new tier
        const currentSettings = await getSettings();
        const newClass = isPB ? 'PRIVATE_BANKING_MINI' : 'MINI';
        const newSettings = { ...currentSettings, defaultClass: newClass };
        await saveSettings(newSettings);
        updateUI(newSettings);
        showStatus();
      });
    });

    // Class radio buttons
    document.querySelectorAll('input[name="defaultClass"]').forEach(radio => {
      radio.addEventListener('change', async (e) => {
        const currentSettings = await getSettings();
        const newSettings = { ...currentSettings, defaultClass: e.target.value };
        await saveSettings(newSettings);
        updateUI(newSettings);
        showStatus();
      });
    });

    // Privacy mode toggle
    document.getElementById('privacyMode').addEventListener('change', async (e) => {
      const currentSettings = await getSettings();
      const newSettings = { ...currentSettings, privacyMode: e.target.checked };
      await saveSettings(newSettings);
      showStatus();
    });

    // Hide logos toggle
    document.getElementById('hideLogos').addEventListener('change', async (e) => {
      const currentSettings = await getSettings();
      const newSettings = { ...currentSettings, hideLogos: e.target.checked };
      await saveSettings(newSettings);
      showStatus();
    });

    // Tickr notifications toggle
    document.getElementById('tickrNotifications').checked = settings.tickrNotifications !== false;
    document.getElementById('tickrNotifications').addEventListener('change', async (e) => {
      const currentSettings = await getSettings();
      const newSettings = { ...currentSettings, tickrNotifications: e.target.checked };
      await saveSettings(newSettings);
      chrome.runtime.sendMessage({ type: 'TICKR_NOTIFICATIONS_CHANGED', enabled: e.target.checked });
      showStatus();
    });
  }

  init();
})();
