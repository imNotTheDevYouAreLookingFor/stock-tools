(function () {
  'use strict';

  // === CONSTANTS ===
  const DEBOUNCE_MS = 300;
  const RECALC_DEBOUNCE_MS = 200;
  const MIN_API_INTERVAL = 1000;
  const FETCH_TIMEOUT_MS = 8000;
  const POST_ORDER_RESET_DELAY_MS = 500;
  const NOTIFICATION_TIMEOUT_MS = 3000;

  const STANDARD_BREAKPOINTS = [
    { limit: 15600,   class: 'MINI',                    label: 'Mini',         percent: 0.0025,  min: 1  },
    { limit: 46000,   class: 'SMALL',                   label: 'Small',        percent: 0.0015,  min: 39 },
    { limit: 143500,  class: 'MEDIUM',                  label: 'Medium',       percent: 0.00069, min: 69 },
    { limit: Infinity, class: 'FASTPRIS',               label: 'Fast Pris',    percent: 0,       min: 99 },
  ];

  const PB_BREAKPOINTS = [
    { limit: 39333,   class: 'PRIVATE_BANKING_MINI',    label: 'PB Mini',      percent: 0.0025,  min: 1  },
    { limit: 180000,  class: 'PRIVATE_BANKING',         label: 'PB',           percent: 0.00079, min: 59 },
    { limit: Infinity, class: 'PRIVATE_BANKING_FASTPRIS', label: 'PB Fast Pris', percent: 0,    min: 99 },
  ];

  // === STATE ===
  let isSwitching = false;
  let pendingSwitchClass = null;
  let capturedHeaders = {};
  let pendingCheck = null;
  let lastApiCall = 0;
  let currentOrderInfo = null;
  let lastKnownClass = null;

  // === SETTINGS ===
  const DEFAULT_SETTINGS = {
    defaultClass: 'MINI',
    mode: 'automatic',
    resetAfterOrder: true,
    privacyMode: false,
    hideLogos: false,
  };

  function getSettings() {
    try {
      const stored = localStorage.getItem('avanzaOptimizerSettings');
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch (e) {
      console.warn('[AvanzaOptimizer] Failed to load settings, using defaults', e.message);
      return DEFAULT_SETTINGS;
    }
  }

  function saveSettings(settings) {
    localStorage.setItem('avanzaOptimizerSettings', JSON.stringify(settings));
  }

  // === HELPERS ===
  const log = (msg, data) => {
    console.log(`%c[AvanzaOptimizer] ${msg}`, 'color: #068e6a; font-weight: bold;', data || '');
  };

  function isPrivateBankingClass(classType) {
    return classType && classType.startsWith('PRIVATE_BANKING');
  }

  function getBreakpoints(currentClass) {
    return isPrivateBankingClass(currentClass) ? PB_BREAKPOINTS : STANDARD_BREAKPOINTS;
  }

  function solveOptimal(amount, currentClass) {
    const breakpoints = getBreakpoints(currentClass);
    for (const bp of breakpoints) {
      if (amount < bp.limit) return bp.class;
    }
    return breakpoints[breakpoints.length - 1].class;
  }

  function calculateFee(amount, classType) {
    const breakpoints = isPrivateBankingClass(classType) ? PB_BREAKPOINTS : STANDARD_BREAKPOINTS;
    const bp = breakpoints.find(b => b.class === classType);
    if (!bp) return 0;
    return Math.max(Math.round(amount * bp.percent * 100) / 100, bp.min);
  }

  function getClassLabel(classType) {
    const all = [...STANDARD_BREAKPOINTS, ...PB_BREAKPOINTS];
    const bp = all.find(b => b.class === classType);
    return bp ? bp.label : classType;
  }

  function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return originalFetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  // === FETCH INTERCEPTION ===
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const [resource, config] = args;
    const url = resource instanceof Request ? resource.url : resource;

    if (typeof url === 'string' && url.includes('preliminary-fee')) {
      if (config && config.headers) {
        try {
          const newHeaders = config.headers instanceof Headers
            ? Object.fromEntries(config.headers.entries())
            : config.headers;
          capturedHeaders = { ...capturedHeaders, ...newHeaders };
        } catch (e) {
          console.warn('[AvanzaOptimizer] Failed to capture fetch headers', e.message);
        }
      }

      const response = await originalFetch.apply(this, args);
      const clone = response.clone();

      try {
        const responseData = await clone.json();
        const payload = config && config.body ? JSON.parse(config.body) : null;
        handlePreliminaryFeeResponse(payload, responseData);
      } catch (e) {
        console.warn('[AvanzaOptimizer] Failed to handle preliminary fee response', e.message);
      }

      return response;
    }

    if (typeof url === 'string' && url.includes('trading-critical/rest/order/new')) {
      const response = await originalFetch.apply(this, args);
      const clone = response.clone();

      try {
        const data = await clone.json();
        if (data.orderRequestStatus === 'SUCCESS') {
          handleOrderSuccess();
        }
      } catch (e) {
        console.warn('[AvanzaOptimizer] Failed to handle order success response', e.message);
      }

      return response;
    }

    return originalFetch.apply(this, args);
  };

  // === XHR INTERCEPTION ===
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  const originalSetRequestHeader = XHR.setRequestHeader;

  XHR.open = function (method, url) {
    this._url = url;
    this._headers = {};
    return originalOpen.apply(this, arguments);
  };

  XHR.setRequestHeader = function (header, value) {
    if (this._headers) {
      this._headers[header] = value;
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  XHR.send = function (postData) {
    const url = this._url;

    if (url && typeof url === 'string' && url.includes('preliminary-fee')) {
      if (this._headers) {
        capturedHeaders = { ...capturedHeaders, ...this._headers };
      }

      this.addEventListener('load', () => {
        try {
          const responseData = JSON.parse(this.responseText);
          const payload = postData ? JSON.parse(postData) : null;
          handlePreliminaryFeeResponse(payload, responseData);
        } catch (e) {
          console.warn('[AvanzaOptimizer] Failed to handle XHR preliminary fee response', e.message);
        }
      });
    }

    if (url && typeof url === 'string' && url.includes('trading-critical/rest/order/new')) {
      this.addEventListener('load', () => {
        try {
          const data = JSON.parse(this.responseText);
          if (data.orderRequestStatus === 'SUCCESS') {
            handleOrderSuccess();
          }
        } catch (e) {
          console.warn('[AvanzaOptimizer] Failed to handle XHR order success response', e.message);
        }
      });
    }

    return originalSend.apply(this, arguments);
  };

  // === CORE LOGIC ===
  function handlePreliminaryFeeResponse(payload, responseData) {
    if (!payload) return;

    const price = parseFloat(payload.price);
    const volume = parseFloat(payload.volume);
    if (!price || !volume || isNaN(price) || isNaN(volume)) return;

    currentOrderInfo = {
      total: price * volume,
      currency: responseData.orderbookCurrency || 'SEK',
      commission: responseData.commission,
    };

    if (pendingCheck) clearTimeout(pendingCheck);
    pendingCheck = setTimeout(() => {
      pendingCheck = null;
      processOrder(currentOrderInfo);
    }, DEBOUNCE_MS);
  }

  async function processOrder(orderInfo) {
    const settings = getSettings();
    const { total, currency } = orderInfo;

    if (currency !== 'SEK') {
      log(`Foreign order (${currency}) - skipping automatic switch`);
      updateUI(orderInfo, null, true);
      return;
    }

    const now = Date.now();
    if (now - lastApiCall < MIN_API_INTERVAL) {
      if (lastKnownClass) {
        handleProcessResult(orderInfo, lastKnownClass, settings);
      }
      return;
    }
    lastApiCall = now;

    try {
      const res = await fetchWithTimeout('/_api/trading/courtageclass/courtageclass/', {
        headers: { 'Content-Type': 'application/json', ...capturedHeaders },
      });
      if (!res.ok) {
        console.warn(`[AvanzaOptimizer] Get class returned ${res.status}`);
        return;
      }
      const data = await res.json();
      const currentClass = data.currentCourtageClass;
      if (!currentClass) return;

      lastKnownClass = currentClass;
      handleProcessResult(orderInfo, currentClass, settings);
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[AvanzaOptimizer] Get class timed out');
      } else {
        console.error('[AvanzaOptimizer] Failed to get current class', e);
      }
    }
  }

  function handleProcessResult(orderInfo, currentClass, settings) {
    const optimal = solveOptimal(orderInfo.total, currentClass);
    log(`Order: ${orderInfo.total.toLocaleString()} SEK. Current: ${currentClass}, Optimal: ${optimal}`);

    if (settings.mode === 'automatic' && currentClass !== optimal) {
      log(`Switching ${currentClass} -> ${optimal}...`);
      performSwitch(optimal)
        .then(() => updateUI(orderInfo, optimal, false))
        .catch(e => console.error('[AvanzaOptimizer] Switch failed in handleProcessResult', e));
    } else {
      updateUI(orderInfo, currentClass, false);
    }
  }

  async function performSwitch(newClass) {
    if (isSwitching) {
      pendingSwitchClass = newClass;
      return;
    }
    isSwitching = true;
    pendingSwitchClass = null;

    try {
      const res = await fetchWithTimeout('/_api/trading/courtageclass/courtageclass/update/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...capturedHeaders },
        body: JSON.stringify({ newClass }),
      });
      const result = await res.json();

      if (result && (result.success || result === true)) {
        log(`Success! Switched to ${newClass}`);
        lastKnownClass = newClass;
        showNotification(`Courtage: ${getClassLabel(newClass)}`);
        if (currentOrderInfo) {
          updateUI(currentOrderInfo, newClass, currentOrderInfo.currency !== 'SEK');
        }
      } else {
        console.error('[AvanzaOptimizer] Switch failed', result);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('[AvanzaOptimizer] Switch timed out');
      } else {
        console.error('[AvanzaOptimizer] Switch error', e);
      }
    } finally {
      isSwitching = false;
      if (pendingSwitchClass) {
        const next = pendingSwitchClass;
        pendingSwitchClass = null;
        performSwitch(next);
      }
    }
  }

  function handleOrderSuccess() {
    const settings = getSettings();
    if (!settings.resetAfterOrder) return;

    log(`Order SUCCESS - resetting to default: ${settings.defaultClass}`);
    setTimeout(() => {
      performSwitch(settings.defaultClass);
    }, POST_ORDER_RESET_DELAY_MS);
  }

  // === UI ===
  const UI_CONTAINER_ID = 'avanza-optimizer-ui';

  function updateUI(orderInfo, currentClass, isForeign) {
    removeUI();

    const settings = getSettings();
    const breakpoints = currentClass ? getBreakpoints(currentClass) : STANDARD_BREAKPOINTS;

    const container = document.createElement('div');
    container.id = UI_CONTAINER_ID;
    container.style.cssText = `
      padding: 12px;
      margin: 8px 0;
      background: #f5f5f5;
      border-radius: 12px;
      border: 1px solid #ddd;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';

    const title = document.createElement('span');
    title.style.cssText = 'color: #333; font-weight: 600; font-size: 13px;';
    title.textContent = isForeign
      ? `Utländsk order (${orderInfo.currency}) - välj courtage manuellt`
      : 'Välj courtage';

    header.appendChild(title);
    header.appendChild(createModeToggle(settings));
    container.appendChild(header);

    const buttonsRow = document.createElement('div');
    buttonsRow.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

    breakpoints.forEach(bp => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isCurrent = bp.class === currentClass;
      const fee = orderInfo ? calculateFee(orderInfo.total, bp.class) : 0;

      btn.style.cssText = `
        padding: 8px 16px;
        border-radius: 20px;
        border: 2px solid ${isCurrent ? '#068e6a' : '#ccc'};
        background: ${isCurrent ? '#068e6a' : '#fff'};
        color: ${isCurrent ? '#fff' : '#333'};
        cursor: pointer;
        font-weight: ${isCurrent ? '600' : '400'};
        font-size: 13px;
        transition: all 0.2s;
      `;

      btn.textContent = isForeign ? bp.label : `${bp.label} ${fee} kr`;
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        performSwitch(bp.class);
      };

      btn.onmouseenter = () => {
        if (!isCurrent) {
          btn.style.borderColor = '#068e6a';
          btn.style.background = '#e0f7f4';
        }
      };
      btn.onmouseleave = () => {
        btn.style.background = isCurrent ? '#068e6a' : '#fff';
        btn.style.borderColor = isCurrent ? '#068e6a' : '#ccc';
      };

      buttonsRow.appendChild(btn);
    });

    container.appendChild(buttonsRow);
    injectUI(container);
  }

  function createModeToggle(settings) {
    const toggle = document.createElement('div');
    toggle.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const label = document.createElement('span');
    label.style.cssText = 'color: #666; font-size: 11px;';
    label.textContent = 'Läge:';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = `
      padding: 4px 12px;
      border-radius: 12px;
      border: 1px solid #ccc;
      background: #fff;
      color: #333;
      cursor: pointer;
      font-size: 11px;
    `;
    btn.textContent = settings.mode === 'automatic' ? 'Auto' : 'Manuell';

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const current = getSettings();
      const newMode = current.mode === 'automatic' ? 'manual' : 'automatic';
      saveSettings({ ...current, mode: newMode });
      showNotification(`Läge: ${newMode === 'automatic' ? 'Automatiskt' : 'Manuellt'}`);
      if (currentOrderInfo) {
        processOrder(currentOrderInfo);
      }
    };

    toggle.appendChild(label);
    toggle.appendChild(btn);
    return toggle;
  }

  function injectUI(container) {
    const courtageRow = document.querySelector('[data-e2e="totalFees"]')?.closest('.order-form-rows-item');
    if (courtageRow && courtageRow.parentElement) {
      courtageRow.parentElement.insertBefore(container, courtageRow);
    }
  }

  function removeUI() {
    document.getElementById(UI_CONTAINER_ID)?.remove();
  }

  // === NOTIFICATION ===
  function showNotification(msg, type = 'success') {
    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      padding: 12px 24px;
      background-color: ${type === 'error' ? '#e74c3c' : '#068e6a'};
      color: #fff;
      border-radius: 20px;
      z-index: 9999;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
    `;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), NOTIFICATION_TIMEOUT_MS);
  }

  // === OBSERVERS ===
  function setupObservers() {
    const mutationObserver = new MutationObserver(() => {
      if (currentOrderInfo && !document.getElementById(UI_CONTAINER_ID)) {
        if (document.querySelector('[data-e2e="totalFees"]')) {
          processOrder(currentOrderInfo);
        }
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    let recalcTimeout = null;
    document.addEventListener('input', (e) => {
      const input = e.target;
      if (input.tagName !== 'INPUT') return;
      if (!input.closest('[class*="order"]')) return;
      if (!currentOrderInfo || !lastKnownClass) return;

      if (recalcTimeout) clearTimeout(recalcTimeout);
      recalcTimeout = setTimeout(() => {
        recalcTimeout = null;
        recalcFromInputs();
      }, RECALC_DEBOUNCE_MS);
    }, true);
  }

  function recalcFromInputs() {
    if (!currentOrderInfo || !lastKnownClass) return;

    const orderForm = document.querySelector('[class*="order"]');
    if (!orderForm) return;

    const inputs = orderForm.querySelectorAll('input');
    let price = null;
    let volume = null;

    inputs.forEach(input => {
      const val = parseFloat(input.value?.replace(',', '.').replace(/\s/g, ''));
      if (isNaN(val) || val <= 0) return;

      const context = (
        (input.placeholder || '') +
        (input.closest('label')?.textContent || '') +
        (input.parentElement?.textContent || '')
      ).toLowerCase();

      if (context.includes('antal') || context.includes('volume') || context.includes('st')) {
        volume = val;
      } else if (context.includes('kurs') || context.includes('pris') || context.includes('price')) {
        price = val;
      } else if (context.includes('belopp') || context.includes('amount')) {
        currentOrderInfo = { ...currentOrderInfo, total: val };
        updateFromInputChange();
      }
    });

    if (price && volume) {
      const newTotal = price * volume;
      if (newTotal !== currentOrderInfo.total) {
        log(`Recalc: ${volume} x ${price} = ${newTotal}`);
        currentOrderInfo = { ...currentOrderInfo, total: newTotal };
        updateFromInputChange();
      }
    }
  }

  async function updateFromInputChange() {
    if (!currentOrderInfo || !lastKnownClass) return;
    if (currentOrderInfo.currency !== 'SEK') return;

    const settings = getSettings();
    const optimal = solveOptimal(currentOrderInfo.total, lastKnownClass);

    if (settings.mode === 'automatic' && lastKnownClass !== optimal) {
      log(`Input change: ${lastKnownClass} -> ${optimal}`);
      await performSwitch(optimal);
      updateUI(currentOrderInfo, optimal, false);
    } else {
      updateUI(currentOrderInfo, lastKnownClass, false);
    }
  }

  // === PRIVACY MODE ===
  const PRIVACY_CLASS = 'aza-optimizer-privacy';
  const PRIVACY_SELECTORS = [
    'aza-my-holdings-card .value',
    '.values-container aza-numerical',
    'aza-positions-table aza-numerical',
    'aza-total-summary aza-numerical',
    'aza-category-header aza-numerical',
    'aza-overview-category-rows aza-numerical',
    'aza-overview-category-rows .row-info .text',
  ];

  function injectPrivacyStyles() {
    if (document.getElementById('aza-optimizer-privacy-styles')) return;
    const style = document.createElement('style');
    style.id = 'aza-optimizer-privacy-styles';
    const rules = PRIVACY_SELECTORS.map(sel => `
      body.${PRIVACY_CLASS} ${sel} {
        filter: blur(7px);
        transition: filter 0.15s;
        cursor: pointer;
        user-select: none;
      }
      body.${PRIVACY_CLASS} ${sel}:hover {
        filter: blur(0);
      }
    `).join('');
    style.textContent = rules;
    (document.head || document.documentElement).appendChild(style);
  }

  function applyPrivacyMode(enabled) {
    injectPrivacyStyles();
    document.body.classList.toggle(PRIVACY_CLASS, enabled);
    log(`Privacy mode: ${enabled ? 'ON' : 'OFF'}`);
  }

  function initPrivacyMode() {
    injectPrivacyStyles();
    if (getSettings().privacyMode) {
      document.body.classList.add(PRIVACY_CLASS);
    }

    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'p') {
        const current = getSettings();
        const next = !current.privacyMode;
        saveSettings({ ...current, privacyMode: next });
        applyPrivacyMode(next);
        showNotification(`Privacy mode: ${next ? 'PÅ' : 'AV'}`);
      }
    });
  }

  // === HIDE LOGOS ===
  const HIDE_LOGOS_CLASS = 'aza-optimizer-hide-logos';

  function injectHideLogosStyles() {
    if (document.getElementById('aza-optimizer-hide-logos-styles')) return;
    const style = document.createElement('style');
    style.id = 'aza-optimizer-hide-logos-styles';
    style.textContent = `
      body.${HIDE_LOGOS_CLASS} aza-feature-toggled-instrument-icon {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function applyHideLogos(enabled) {
    injectHideLogosStyles();
    document.body.classList.toggle(HIDE_LOGOS_CLASS, enabled);
    log(`Hide logos: ${enabled ? 'ON' : 'OFF'}`);
  }

  function initHideLogos() {
    injectHideLogosStyles();
    if (getSettings().hideLogos) {
      document.body.classList.add(HIDE_LOGOS_CLASS);
    }

    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'l') {
        const current = getSettings();
        const next = !current.hideLogos;
        saveSettings({ ...current, hideLogos: next });
        applyHideLogos(next);
        showNotification(`Loggor: ${next ? 'dolda' : 'visas'}`);
      }
    });
  }

  // === INIT ===
  function init() {
    setupObservers();
    initPrivacyMode();
    initHideLogos();
    log('Ready');
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  window.addEventListener('avanzaOptimizerSettingsChanged', (e) => {
    log('Settings updated from popup', e.detail);
    if (typeof e.detail.privacyMode === 'boolean') {
      applyPrivacyMode(e.detail.privacyMode);
    }
    if (typeof e.detail.hideLogos === 'boolean') {
      applyHideLogos(e.detail.hideLogos);
    }
    if (currentOrderInfo) {
      processOrder(currentOrderInfo);
    }
  });
})();
