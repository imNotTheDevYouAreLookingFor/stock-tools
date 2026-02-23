(function () {
  'use strict';

  console.log('%c[AvanzaOptimizer] Ready', 'color: #00d1b2; font-weight: bold;');

  // === STATE ===
  let isSwitching = false;
  let capturedHeaders = {};
  let pendingCheck = null;
  let lastApiCall = 0;
  let currentOrderInfo = null;
  let lastKnownClass = null;

  // === CONSTANTS ===
  const DEBOUNCE_MS = 300;
  const MIN_API_INTERVAL = 1000;

  const STANDARD_BREAKPOINTS = [
    { limit: 15600, class: 'MINI', label: 'Mini', percent: 0.0025, min: 1 },
    { limit: 46000, class: 'SMALL', label: 'Small', percent: 0.0015, min: 39 },
    { limit: 143500, class: 'MEDIUM', label: 'Medium', percent: 0.00069, min: 69 },
    { limit: Infinity, class: 'FASTPRIS', label: 'Fast Pris', percent: 0, min: 99 },
  ];

  const PB_BREAKPOINTS = [
    { limit: 39333, class: 'PRIVATE_BANKING_MINI', label: 'PB Mini', percent: 0.0025, min: 1 },
    { limit: 180000, class: 'PRIVATE_BANKING', label: 'PB', percent: 0.00079, min: 59 },
    { limit: Infinity, class: 'PRIVATE_BANKING_FASTPRIS', label: 'PB Fast Pris', percent: 0, min: 99 },
  ];

  // === SETTINGS ===
  const DEFAULT_SETTINGS = {
    defaultClass: 'MINI',
    mode: 'automatic',
    resetAfterOrder: true,
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
    console.log(`%c[AvanzaOptimizer] ${msg}`, 'color: #00d1b2; font-weight: bold;', data || '');
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
    const percentFee = amount * bp.percent;
    const fee = Math.max(percentFee, bp.min);
    return Math.round(fee * 100) / 100;
  }

  function getClassLabel(classType) {
    const all = [...STANDARD_BREAKPOINTS, ...PB_BREAKPOINTS];
    const bp = all.find(b => b.class === classType);
    return bp ? bp.label : classType;
  }

  // === FETCH INTERCEPTION ===
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    let [resource, config] = args;
    let url = resource instanceof Request ? resource.url : resource;

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
        let payload = null;
        if (config && config.body) {
          payload = JSON.parse(config.body);
        }
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
          let payload = postData ? JSON.parse(postData) : null;
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
    if (!price || !volume) return;

    const total = price * volume;

    currentOrderInfo = {
      total,
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

    // Throttle API calls
    const now = Date.now();
    if (now - lastApiCall < MIN_API_INTERVAL) {
      if (lastKnownClass) {
        handleProcessResult(orderInfo, lastKnownClass, settings);
      }
      return;
    }
    lastApiCall = now;

    try {
      const res = await originalFetch('/_api/trading/courtageclass/courtageclass/', {
        headers: { 'Content-Type': 'application/json', ...capturedHeaders },
      });
      if (!res.ok) return;
      const data = await res.json();
      const currentClass = data.currentCourtageClass;
      if (!currentClass) return;

      lastKnownClass = currentClass;
      handleProcessResult(orderInfo, currentClass, settings);
    } catch (e) {
      console.error('[AvanzaOptimizer] Failed to get current class', e);
    }
  }

  function handleProcessResult(orderInfo, currentClass, settings) {
    const optimal = solveOptimal(orderInfo.total, currentClass);
    log(`Order: ${orderInfo.total.toLocaleString()} SEK. Current: ${currentClass}, Optimal: ${optimal}`);

    if (settings.mode === 'automatic' && currentClass !== optimal) {
      log(`Switching ${currentClass} -> ${optimal}...`);
      performSwitch(optimal).then(() => {
        updateUI(orderInfo, optimal, false);
      });
    } else {
      updateUI(orderInfo, currentClass, false);
    }
  }

  async function performSwitch(newClass) {
    if (isSwitching) return;
    isSwitching = true;

    try {
      const res = await originalFetch('/_api/trading/courtageclass/courtageclass/update/', {
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
      console.error('[AvanzaOptimizer] Switch error', e);
    } finally {
      isSwitching = false;
    }
  }

  function handleOrderSuccess() {
    const settings = getSettings();
    if (!settings.resetAfterOrder) return;

    log(`Order SUCCESS - resetting to default: ${settings.defaultClass}`);
    setTimeout(() => {
      performSwitch(settings.defaultClass);
    }, 500);
  }

  // === UI ===
  const UI_CONTAINER_ID = 'avanza-optimizer-ui';

  function updateUI(orderInfo, currentClass, isForeign) {
    removeUI();

    const settings = getSettings();
    const breakpoints = currentClass ? getBreakpoints(currentClass) : STANDARD_BREAKPOINTS;
    const optimal = orderInfo ? solveOptimal(orderInfo.total, currentClass) : null;

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

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';

    const title = document.createElement('span');
    title.style.cssText = 'color: #333; font-weight: 600; font-size: 13px;';
    title.textContent = isForeign
      ? `Utländsk order (${orderInfo.currency}) - välj courtage manuellt`
      : 'Välj courtage';

    const toggle = createModeToggle(settings);

    header.appendChild(title);
    header.appendChild(toggle);
    container.appendChild(header);

    // Buttons
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
        border: 2px solid ${isCurrent ? '#00d1b2' : '#ccc'};
        background: ${isCurrent ? '#00d1b2' : '#fff'};
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
          btn.style.borderColor = '#00d1b2';
          btn.style.background = '#e0f7f4';
        }
      };
      btn.onmouseleave = () => {
        btn.style.background = isCurrent ? '#00d1b2' : '#fff';
        btn.style.borderColor = isCurrent ? '#00d1b2' : '#ccc';
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
      const newMode = settings.mode === 'automatic' ? 'manual' : 'automatic';
      saveSettings({ ...settings, mode: newMode });
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
    const existing = document.getElementById(UI_CONTAINER_ID);
    if (existing) existing.remove();
  }

  // === NOTIFICATION ===
  function showNotification(msg, type = 'success') {
    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      padding: 12px 24px;
      background-color: ${type === 'error' ? '#e74c3c' : '#00d1b2'};
      color: #fff;
      border-radius: 20px;
      z-index: 100000;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
    `;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  }

  // === OBSERVERS ===
  function setupObservers() {
    // Re-inject UI if Angular re-renders
    const mutationObserver = new MutationObserver(() => {
      if (currentOrderInfo && !document.getElementById(UI_CONTAINER_ID)) {
        const courtageRow = document.querySelector('[data-e2e="totalFees"]');
        if (courtageRow) {
          processOrder(currentOrderInfo);
        }
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    // Watch input changes for recalculation
    let recalcTimeout = null;
    document.addEventListener('input', (e) => {
      const input = e.target;
      if (input.tagName !== 'INPUT') return;
      if (!input.closest('[class*="order"]')) return;
      if (!currentOrderInfo || !lastKnownClass) return;

      if (recalcTimeout) clearTimeout(recalcTimeout);
      recalcTimeout = setTimeout(() => {
        recalcFromInputs();
      }, 200);
    }, true);
  }

  function recalcFromInputs() {
    if (!currentOrderInfo || !lastKnownClass) return;

    const inputs = document.querySelectorAll('input');
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
        currentOrderInfo.total = val;
        updateFromInputChange();
        return;
      }
    });

    if (price && volume) {
      const newTotal = price * volume;
      if (newTotal !== currentOrderInfo.total) {
        log(`Recalc: ${volume} x ${price} = ${newTotal}`);
        currentOrderInfo.total = newTotal;
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

  // === INIT ===
  if (document.body) {
    setupObservers();
  } else {
    document.addEventListener('DOMContentLoaded', setupObservers);
  }

  // Listen for settings changes from popup
  window.addEventListener('avanzaOptimizerSettingsChanged', (e) => {
    log('Settings updated from popup', e.detail);
    if (currentOrderInfo) {
      processOrder(currentOrderInfo);
    }
  });
})();
