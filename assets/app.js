const APP_VERSION = '12.4.0';
const STORAGE_KEY = 'harmonogram-mow-state-v12';
const LEGACY_STORAGE_KEYS = ['harmonogram-mow-state-v11', 'harmonogram-mow-state-v10', 'harmonogram-mow-state-v9', 'harmonogram-mow-state-v8'];
const MAX_INTERNAT_CACHE_WEEKS = 8;
const DEFAULT_STATE = {
  backendUrl: '',
  viewToken: '',
  adminToken: '',
  layoutMode: 'auto',
  shareMode: 'full',
  dayFilter: 'all',
  educator: 'Dymek',
  calendarEducator: 'Dymek',
  weeks: [],
  history: [],
  alerts: [],
  changes: [],
  internatWeeks: {},
  availableEducators: [],
  seenAlertIds: [],
  lastSync: null,
  activeTab: 1,
  weekTabOffset: 0,
  backendError: ''
};

const $ = (id) => document.getElementById(id);
let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;
let serviceWorkerReloading = false;
let automaticRefreshPromise = null;
let hiddenAt = 0;
const internatWeekRequests = new Map();
let state = loadState();
if (state.weeks && state.weeks.length) {
  state.activeTab = getPreferredWeekIndex(state.weeks);
  state.weekTabOffset = getWeekTabOffsetForActive(state.activeTab, state.weeks.length);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallUi();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallUi();
  toast('Aplikacja została zainstalowana.');
});

$('refreshBtn').addEventListener('click', refreshFromBackend);
$('settingsBtn').addEventListener('click', () => {
  $('settingsPanel').classList.toggle('hidden');
  $('actionsMenu')?.removeAttribute('open');
});
$('sampleBtn').addEventListener('click', loadSampleData);
$('dashboardBtn').addEventListener('click', loadDashboardOnly);
const testBackendBtn = $('testBackendBtn');
if (testBackendBtn) testBackendBtn.addEventListener('click', testBackendConnection);
$('saveSettingsBtn').addEventListener('click', () => saveSettings());
$('clearCacheBtn').addEventListener('click', clearCache);
$('exportBtn').addEventListener('click', exportHistoryCsv);
$('notifyBtn').addEventListener('click', enableNotifications);
const installBtn = $('installBtn');
if (installBtn) installBtn.addEventListener('click', installApplication);
const updateBtn = $('updateBtn');
if (updateBtn) updateBtn.addEventListener('click', () => checkForAppUpdate(true));
const dayFilterEl = $('dayFilter');
if (dayFilterEl) dayFilterEl.addEventListener('change', () => {
  state.dayFilter = dayFilterEl.value || 'all';
  persist();
  render();
  if (state.dayFilter === 'internat') ensureInternatWeekLoaded();
});
const printBtn = $('printBtn');
if (printBtn) printBtn.addEventListener('click', printCurrentWeekPdf);
const shareViewBtn = $('shareViewBtn');
if (shareViewBtn) shareViewBtn.addEventListener('click', copyShareSummary);
const educatorInput = $('educator');
if (educatorInput) educatorInput.addEventListener('change', () => { state.educator = educatorInput.value.trim() || 'Dymek'; persist(); render(); });
const actionsMenu = $('actionsMenu');
if (actionsMenu) actionsMenu.querySelectorAll('button').forEach(button => {
  button.addEventListener('click', () => actionsMenu.removeAttribute('open'));
});

hydrateSettings();
render();
initializePwa();
if (state.backendUrl && (state.adminToken || state.viewToken)) {
  queueMicrotask(() => autoRefreshFromBackend('start'));
} else if (!state.weeks.length) {
  loadSampleData(false);
}

window.addEventListener('pageshow', event => {
  if (event.persisted) autoRefreshFromBackend('resume');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) autoRefreshFromBackend('resume');
  hiddenAt = 0;
});

function loadState() {
  const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) || {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const merged = {
        ...freshDefaultState(),
        ...parsed,
        weeks: Array.isArray(parsed.weeks) ? parsed.weeks.sort(compareWeekLikeAsc) : [],
        history: Array.isArray(parsed.history) ? sortHistoryRows(parsed.history) : [],
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
        changes: Array.isArray(parsed.changes) ? parsed.changes : [],
        internatWeeks: parsed.internatWeeks && typeof parsed.internatWeeks === 'object' && !Array.isArray(parsed.internatWeeks) ? parsed.internatWeeks : {},
        availableEducators: Array.isArray(parsed.availableEducators) ? parsed.availableEducators : [],
        seenAlertIds: Array.isArray(parsed.seenAlertIds) ? parsed.seenAlertIds : []
      };
      if (key !== STORAGE_KEY) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
      LEGACY_STORAGE_KEYS.forEach(legacyKey => localStorage.removeItem(legacyKey));
      return merged;
    } catch {}
  }
  return freshDefaultState();
}
function freshDefaultState() {
  return {
    ...DEFAULT_STATE,
    weeks: [],
    history: [],
    alerts: [],
    changes: [],
    internatWeeks: {},
    availableEducators: [],
    seenAlertIds: []
  };
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error('Nie udało się zapisać stanu aplikacji.', error);
    return false;
  }
}
function hydrateSettings() {
  $('backendUrl').value = state.backendUrl || '';
  $('viewToken').value = state.viewToken || '';
  $('adminToken').value = state.adminToken || '';
  $('layoutMode').value = state.layoutMode || 'auto';
  if ($('shareMode')) $('shareMode').value = state.shareMode || 'full';
  if ($('dayFilter')) $('dayFilter').value = state.dayFilter || 'all';
  $('educator').value = state.educator || 'Dymek';
  if ($('appVersion')) $('appVersion').textContent = APP_VERSION;
  renderEducatorDatalist();
  applyLayoutMode();
  updateInstallUi();
}

function normalizeBackendUrl(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  v = v.replace(/\s+/g, '');
  v = v.replace(/\/dev(?:\?.*)?$/, '/exec');
  const url = new URL(v);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com') {
    throw new Error('Backend musi być adresem HTTPS w domenie script.google.com.');
  }
  if (!/\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
    throw new Error('Adres backendu musi być adresem wdrożenia Apps Script zakończonym /exec.');
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function isAllowedBridgeOrigin(origin) {
  try {
    const url = new URL(String(origin || ''));
    return url.protocol === 'https:' && (
      url.hostname === 'script.google.com' ||
      url.hostname.endsWith('.googleusercontent.com')
    );
  } catch (_) {
    return false;
  }
}

function isExpectedBridgeMessage(event, iframeWindow, bridgeNonce) {
  const data = event && event.data;
  if (!data || data.source !== 'harmonogram-mow-backend') return false;
  if (event.source === iframeWindow) {
    return !data.bridgeNonce || data.bridgeNonce === bridgeNonce;
  }
  return data.bridgeNonce === bridgeNonce && isAllowedBridgeOrigin(event.origin);
}

function createBridgeNonce() {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, value => value.toString(16).padStart(8, '0')).join('');
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function saveSettings(options = {}) {
  try {
    state.backendUrl = normalizeBackendUrl($('backendUrl').value.trim());
  } catch (error) {
    $('settingsPanel').classList.remove('hidden');
    toast(error.message);
    return false;
  }
  state.viewToken = $('viewToken').value.trim();
  state.adminToken = $('adminToken').value.trim();
  state.layoutMode = $('layoutMode').value || 'auto';
  state.shareMode = $('shareMode') ? ($('shareMode').value || 'full') : 'full';
  state.dayFilter = $('dayFilter') ? ($('dayFilter').value || 'all') : 'all';
  state.educator = $('educator').value.trim() || 'Dymek';
  applyLayoutMode();
  if (!persist()) {
    toast('Nie udało się zapisać ustawień. Wyczyść dane aplikacji i spróbuj ponownie.');
    return false;
  }
  const mode = state.adminToken ? 'tryb administratora' : (state.viewToken ? 'tryb podglądu' : 'bez tokenu');
  if (!options.silent) toast('Ustawienia zapisane. Widok: ' + state.educator + '. ' + mode + '. Kalendarz: tylko ' + (state.calendarEducator || 'Dymek') + '.');
  render();
  return true;
}

function applyLayoutMode() {
  const mode = state.layoutMode || 'auto';
  document.documentElement.dataset.layout = mode;
}

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallUi() {
  const button = $('installBtn');
  if (!button) return;
  if (isStandaloneMode()) {
    button.textContent = 'Aplikacja zainstalowana';
    button.disabled = true;
    return;
  }
  button.disabled = false;
  button.textContent = deferredInstallPrompt ? 'Zainstaluj aplikację' : 'Jak zainstalować';
}

async function installApplication() {
  if (isStandaloneMode()) {
    toast('Ta aplikacja jest już uruchomiona jako zainstalowana PWA.');
    return;
  }
  if (!deferredInstallPrompt) {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
    toast(ios
      ? 'Na iPhonie lub iPadzie wybierz Udostępnij → Dodaj do ekranu początkowego.'
      : 'W menu przeglądarki wybierz „Zainstaluj aplikację” albo „Dodaj do ekranu głównego”.');
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateInstallUi();
}

async function initializePwa() {
  const status = $('updateStatus');
  if (!('serviceWorker' in navigator)) {
    if (status) status.textContent = `Wersja ${APP_VERSION} • brak obsługi offline`;
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const reloadKey = `harmonogram-mow-reloaded-${APP_VERSION}`;
    if (serviceWorkerReloading || sessionStorage.getItem(reloadKey)) return;
    serviceWorkerReloading = true;
    sessionStorage.setItem(reloadKey, '1');
    window.location.reload();
  });
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register('./service-worker.js');
    watchServiceWorkerRegistration(serviceWorkerRegistration);
    await checkForAppUpdate(false);
  } catch (error) {
    if (status) status.textContent = `Wersja ${APP_VERSION} • tryb online`;
    console.warn('Nie udało się uruchomić aktualizacji PWA.', error);
  }
}

function watchServiceWorkerRegistration(registration) {
  const status = $('updateStatus');
  if (registration.waiting) {
    if (status) status.textContent = 'Aktualizacja gotowa — przeładowuję…';
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    if (status) status.textContent = 'Pobieranie aktualizacji…';
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        if (status) status.textContent = 'Aktualizacja gotowa — przeładowuję…';
      } else if (worker.state === 'activated') {
        if (status) status.textContent = `Wersja ${APP_VERSION} • aktualna`;
      }
    });
  });
}

async function checkForAppUpdate(manual = false) {
  const status = $('updateStatus');
  const button = $('updateBtn');
  if (!serviceWorkerRegistration) {
    if (manual) toast('Aktualizacje PWA nie są dostępne w tej przeglądarce.');
    return;
  }
  if (button) button.disabled = true;
  if (status) status.textContent = 'Sprawdzanie aktualizacji…';
  try {
    await serviceWorkerRegistration.update();
    if (serviceWorkerRegistration.waiting) {
      serviceWorkerRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      if (status) status.textContent = 'Aktualizacja gotowa — przeładowuję…';
      return;
    }
    if (status) status.textContent = `Wersja ${APP_VERSION} • aktualna`;
    if (manual) toast(`Masz aktualną wersję ${APP_VERSION}.`);
  } catch (error) {
    if (status) status.textContent = `Wersja ${APP_VERSION} • nie sprawdzono online`;
    if (manual) toast('Nie udało się sprawdzić aktualizacji: ' + error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function backendUrlWithParams(action, extraParams = {}) {
  const url = new URL(state.backendUrl);
  // Apps Script can otherwise bind the request to another signed-in Google
  // account (for example /u/1/) and return a "file not found" page instead of
  // the web-app response. The deployment belongs to the primary account.
  url.searchParams.set('authuser', '0');
  url.searchParams.set('action', action);
  url.searchParams.set('educator', state.educator || 'Dymek');
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  if (state.adminToken) url.searchParams.set('token', state.adminToken);
  else if (state.viewToken) url.searchParams.set('token', state.viewToken);
  url.searchParams.set('transport', 'bridge');
  url.searchParams.set('_', String(Date.now()));
  return url;
}

async function clearCache() {
  [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].forEach(key => localStorage.removeItem(key));
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('harmonogram-mow-')).map(key => caches.delete(key)));
    }
  } catch (error) {
    console.warn('Nie udało się wyczyścić Cache Storage.', error);
  }
  state = freshDefaultState();
  hydrateSettings();
  render();
  toast('Wyczyszczono lokalne dane i pamięć offline aplikacji.');
}

async function enableNotifications() {
  if (!('Notification' in window)) { toast('Ta przeglądarka nie obsługuje powiadomień.'); return; }
  const permission = await Notification.requestPermission();
  toast(permission === 'granted' ? 'Powiadomienia włączone.' : 'Powiadomienia nie zostały włączone.');
}

async function loadSampleData(showToast = true) {
  try {
    const response = await fetch('./data/sample-weeks.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    applyPayload(payload);
    if (showToast) toast('Załadowano dane testowe.');
  } catch (error) {
    toast('Nie udało się załadować danych testowych: ' + error.message);
  }
}

async function autoRefreshFromBackend(reason = 'start') {
  if (!state.backendUrl || (!state.adminToken && !state.viewToken)) return;
  if (automaticRefreshPromise) return automaticRefreshPromise;
  automaticRefreshPromise = refreshFromBackend({ automatic: true, reason });
  try {
    await automaticRefreshPromise;
  } finally {
    automaticRefreshPromise = null;
  }
}

async function refreshFromBackend(options = {}) {
  if (!saveSettings({ silent: true })) return;
  if (!state.backendUrl) {
    if (!options.automatic) {
      toast('Najpierw wpisz adres backendu Apps Script w ustawieniach.');
      $('settingsPanel').classList.remove('hidden');
    }
    return;
  }
  const button = $('refreshBtn');
  if (button) button.disabled = true;
  try {
    const action = state.adminToken ? 'sync' : 'dashboard';
    toast(state.adminToken
      ? (options.automatic ? 'Automatyczna synchronizacja przy uruchomieniu…' : 'Synchronizuję Gmail i Kalendarz…')
      : 'Pobieram widok z backendu bez zapisu do kalendarza…');
    const payload = await requestBackend(backendUrlWithParams(action));
    state.backendError = '';
    const dashboard = extractDashboard(payload);
    applyPayload(dashboard);
    if (state.dayFilter === 'internat') await ensureInternatWeekLoaded();
    const suffix = (state.educator || 'Dymek') === (state.calendarEducator || 'Dymek') ? '' : ' Kalendarz Google pozostał tylko dla ' + (state.calendarEducator || 'Dymek') + '.';
    toast((state.adminToken ? 'Synchronizacja zakończona.' : 'Widok pobrany.') + suffix);
  } catch (error) {
    state.backendError = error.message;
    persist();
    render();
    toast(`Błąd backendu: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadDashboardOnly() {
  if (!saveSettings({ silent: true })) return;
  if (!state.backendUrl) {
    toast('Najpierw wpisz adres backendu Apps Script w ustawieniach.');
    $('settingsPanel').classList.remove('hidden');
    return;
  }
  const button = $('dashboardBtn');
  button.disabled = true;
  try {
    toast('Pobieram dane bez synchronizacji kalendarza…');
    const payload = await requestBackend(backendUrlWithParams('dashboard'));
    state.backendError = '';
    applyPayload(extractDashboard(payload));
    if (state.dayFilter === 'internat') await ensureInternatWeekLoaded();
    toast('Widok pobrany. Nic nie zapisano do Kalendarza Google.');
  } catch (error) {
    state.backendError = error.message;
    persist();
    render();
    toast(`Błąd backendu: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function requestBackend(url) {
  try {
    return await iframeBridge(url.toString());
  } catch (bridgeError) {
    try {
      return await jsonp(url.toString());
    } catch (jsonpError) {
      throw new Error(
        'Most iframe i JSONP nie zwróciły danych. ' +
        'Iframe: ' + (bridgeError && bridgeError.message ? bridgeError.message : 'brak szczegółów') +
        ' | JSONP: ' + (jsonpError && jsonpError.message ? jsonpError.message : 'brak szczegółów') +
        '. Aplikacja wymusza teraz właściwe konto Google (authuser=0). Otwórz link testu backendu; odpowiedź ok:true albo ok:false potwierdza działanie wdrożenia. Sprawdź też, czy przeglądarka nie blokuje script.google.com ani googleusercontent.com.'
      );
    }
  }
}

function buildPublicTestUrl(url) {
  const u = new URL(url.toString());
  u.searchParams.set('action', 'ping');
  u.searchParams.delete('callback');
  u.searchParams.set('transport', 'bridge');
  return u.toString();
}

async function testBackendConnection() {
  if (!saveSettings({ silent: true })) return;
  if (!state.backendUrl) {
    toast('Najpierw wpisz adres backendu /exec.');
    return;
  }
  const button = $('testBackendBtn');
  button.disabled = true;
  try {
    toast('Testuję backend Apps Script…');
    const payload = await requestBackend(backendUrlWithParams('ping'));
    state.backendError = '';
    const dashboard = extractDashboard(payload);
    applyPayload(dashboard);
    toast('Backend działa. Odpowiedź Apps Script jest poprawna.');
  } catch (error) {
    state.backendError = error.message;
    persist();
    render();
    toast('Błąd testu backendu: ' + error.message);
  } finally {
    button.disabled = false;
  }
}

function extractDashboard(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('pusta odpowiedź backendu');
  if (payload.ok === false) throw new Error(payload.error || 'backend zwrócił ok=false');
  const candidate = payload.data || payload.dashboard || payload.result || payload;
  const weeks = candidate.weeks || payload.weeks;
  const history = candidate.history || payload.history || [];
  const alerts = candidate.alerts || payload.alerts || [];
  if (!Array.isArray(weeks)) throw new Error('odpowiedź backendu nie zawiera tablicy weeks');
  return {
    ...candidate,
    weeks,
    history,
    alerts,
    generatedAt: candidate.generatedAt || payload.generatedAt || payload.updatedAt,
    updatedAt: candidate.updatedAt || payload.updatedAt || candidate.generatedAt || payload.generatedAt,
    educator: candidate.educator || payload.educator || state.educator || 'Dymek',
    calendarEducator: candidate.calendarEducator || payload.calendarEducator || 'Dymek',
    security: candidate.security || payload.security || {}
  };
}

function applyPayload(payload) {
  const normalized = normalizePayload(payload);
  const incomingAlerts = normalized.alerts || [];
  const newAlerts = incomingAlerts.filter(alert => alert.id && !state.seenAlertIds.includes(alert.id));
  state.weeks = normalized.weeks;
  state.history = normalized.history;
  state.alerts = incomingAlerts;
  state.changes = normalized.changes || collectChangesFromWeeks(normalized.weeks);
  state.internatWeeks = mergeInternatWeekCache(state.internatWeeks, normalized.internatWeeks, normalized.weeks, normalized.hasInternatWeeks);
  state.availableEducators = normalized.availableEducators || state.availableEducators || [];
  state.lastSync = normalized.updatedAt || new Date().toISOString();
  state.educator = normalized.educator || state.educator || 'Dymek';
  state.calendarEducator = normalized.calendarEducator || state.calendarEducator || 'Dymek';
  state.security = normalized.security || state.security || {};
  state.activeTab = getPreferredWeekIndex(state.weeks);
  state.weekTabOffset = getWeekTabOffsetForActive(state.activeTab, state.weeks.length);
  if (newAlerts.length) {
    notifyAlerts(newAlerts);
    state.seenAlertIds = Array.from(new Set([...(state.seenAlertIds || []), ...newAlerts.map(a => a.id)])).slice(-100);
  }
  persist();
  hydrateSettings();
  render();
}

function normalizePayload(payload) {
  const source = payload && payload.data && payload.data.weeks ? payload.data : payload;
  const cleanSource = repairMojibake(source || {});
  const weeks = (cleanSource.weeks || []).map(normalizeWeek).sort(compareWeekLikeAsc);
  const history = sortHistoryRows(cleanSource.history && cleanSource.history.length ? cleanSource.history : weeks.map(weekToHistoryRow));
  const hasInternatWeeks = Object.prototype.hasOwnProperty.call(cleanSource, 'internatWeeks');
  const internatWeeks = Object.fromEntries(Object.entries(cleanSource.internatWeeks || {}).map(([weekStart, week]) => [weekStart, normalizeInternatWeek(week)]));
  return { weeks, history, alerts: cleanSource.alerts || [], changes: cleanSource.changes || collectChangesFromWeeks(weeks), internatWeeks, hasInternatWeeks, availableEducators: cleanSource.availableEducators || [], updatedAt: cleanSource.updatedAt || cleanSource.generatedAt, educator: cleanSource.educator, calendarEducator: cleanSource.calendarEducator, security: cleanSource.security || {} };
}

function mergeInternatWeekCache(existing = {}, incoming = {}, weeks = [], hasIncoming = false) {
  const merged = {
    ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
    ...(hasIncoming && incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {})
  };

  (weeks || []).forEach(week => {
    const weekStart = getWeekCacheKey(week);
    const cached = weekStart ? merged[weekStart] : null;
    if (!cached) return;
    const expectedVersion = String(week.sourceVersion || '');
    const cachedVersion = String(cached.sourceVersion || '');
    if (expectedVersion && expectedVersion !== cachedVersion) delete merged[weekStart];
  });

  return Object.fromEntries(Object.entries(merged)
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .slice(-MAX_INTERNAT_CACHE_WEEKS));
}

function repairMojibake(value) {
  if (typeof value === 'string') return repairMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairMojibake);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repairMojibake(item)]));
  }
  return value;
}

function repairMojibakeText(value = '') {
  return String(value)
    .replace(/\u00C4\u2026/g, '\u0105')
    .replace(/\u00C4\u2021/g, '\u0107')
    .replace(/\u00C4\u2122/g, '\u0119')
    .replace(/\u00C5\u201A/g, '\u0142')
    .replace(/\u00C5\u201E/g, '\u0144')
    .replace(/\u00C3\u00B3/g, '\u00F3')
    .replace(/\u00C5\u203A/g, '\u015B')
    .replace(/\u00C5\u015F/g, '\u017A')
    .replace(/\u00C5\u013D/g, '\u017C')
    .replace(/\u00C4\u201E/g, '\u0104')
    .replace(/\u00C4\u2020/g, '\u0106')
    .replace(/\u00C4\u02DC/g, '\u0118')
    .replace(/\u00C5\u0081/g, '\u0141')
    .replace(/\u00C5\u192/g, '\u0143')
    .replace(/\u00C3\u201C/g, '\u00D3')
    .replace(/\u00C5\u0161/g, '\u015A')
    .replace(/\u00C5\u00BB/g, '\u017B')
    .replace(/\u00C5\u00B9/g, '\u0179')
    .replace(/\u00E2\u20AC\u201C/g, '\u2013')
    .replace(/\u00E2\u20AC\u201D/g, '\u2014')
    .replace(/\u00E2\u2020\u2019/g, '\u2192')
    .replace(/\u00E2\u20AC\u00A2/g, '\u2022')
    .replace(/\u00E2\u20AC\u017E/g, '\u201E')
    .replace(/\u00E2\u20AC\u009D/g, '\u201D');
}

function normalizeWeek(week) {
  const days = DAYS.map((day, index) => {
    const incoming = (week.days || [])[index] || {};
    const isoDate = incoming.isoDate || addDaysIso(week.dateFrom, index);
    const shifts = (incoming.shifts || []).map(normalizeShift);
    const hoursDay = numberOr(incoming.hoursDay, shifts.reduce((sum, shift) => sum + numberOr(shift.duration, 0), 0));
    const zmieniam = incoming.zmieniam || firstNonEmpty(shifts.map(shift => shift.replacesPerson || shift.zmieniam || '')) || '';
    const zmienia = incoming.zmienia || lastNonEmpty(shifts.map(shift => shift.replacedByPerson || shift.zmienia || '')) || '';
    const changes = Array.isArray(incoming.changes) ? incoming.changes : [];
    const warnings = detectDayWarnings(shifts, incoming, index);
    const hasChange = Boolean(incoming.hasChange || changes.length);
    return { ...day, date: incoming.date || formatShortDate(isoDate), isoDate, shifts, hoursDay, weekend: index >= 5, zmieniam, zmienia, changes, hasChange, warnings };
  });
  const totalHours = round(days.reduce((sum, day) => sum + day.hoursDay, 0));
  const weekendHours = round(days.filter(d => d.weekend).reduce((sum, day) => sum + day.hoursDay, 0));
  return { ...week, days, summary: { ...(week.summary || {}), totalHours, overtimeHours: Math.max(0, round(totalHours - 24)), weekendHours, weekendWorkDays: days.filter(d => d.weekend && d.hoursDay > 0).length } };
}

function normalizeInternatWeek(week = {}) {
  const weekStart = week.weekStart || week.dateFrom || '';
  const days = DAYS.map((day, index) => {
    const incoming = (week.days || [])[index] || {};
    const isoDate = incoming.isoDate || addDaysIso(weekStart, index);
    const shifts = (incoming.shifts || []).map(shift => ({
      ...normalizeShift(shift),
      educator: shift.educator || shift.person || shift.personRaw || 'Nieznana osoba'
    })).sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')) || String(a.educator).localeCompare(String(b.educator), 'pl'));
    return {
      ...day,
      date: incoming.date || formatShortDate(isoDate),
      isoDate,
      weekend: index >= 5,
      shifts,
      hoursDay: round(shifts.reduce((sum, shift) => sum + numberOr(shift.duration, 0), 0))
    };
  });
  const names = Array.from(new Set(days.flatMap(day => day.shifts.map(shift => shift.educator)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pl'));
  const computedShiftCount = days.reduce((sum, day) => sum + day.shifts.length, 0);
  const computedTotalHours = round(days.reduce((sum, day) => sum + day.hoursDay, 0));
  return {
    ...week,
    weekStart,
    dateFrom: week.dateFrom || weekStart,
    dateTo: week.dateTo || addDaysIso(weekStart, 6),
    range: week.range || `${formatShortDate(weekStart)} – ${formatShortDate(addDaysIso(weekStart, 6))}`,
    days,
    staff: Array.isArray(week.staff) && week.staff.length ? week.staff : names,
    staffCount: names.length,
    shiftCount: computedShiftCount,
    totalHours: computedTotalHours,
    validationWarnings: validateInternatWeekDays(days)
  };
}

function validateInternatWeekDays(days = []) {
  const warnings = [];
  days.forEach(day => {
    const shifts = Array.isArray(day.shifts) ? day.shifts : [];
    const groupKeys = new Set(shifts.map(shift => getInternatShiftGroup(shift).key));
    const hasNumberedGroups = [...groupKeys].some(key => key.startsWith('group-'));
    const hasVacationGroups = [...groupKeys].some(key => key.startsWith('vacation-'));
    if (hasNumberedGroups && hasVacationGroups) {
      warnings.push(`${day.name || day.isoDate}: jednocześnie wykryto grupy 1–8 i wakacyjne A/B.`);
    }

    const hoursByEducator = new Map();
    shifts.forEach(shift => {
      const educator = String(shift.educator || 'Nieznana osoba').trim();
      hoursByEducator.set(educator, round((hoursByEducator.get(educator) || 0) + numberOr(shift.duration, 0)));
    });
    const impossible = [...hoursByEducator.entries()].filter(([, hours]) => hours > 24);
    if (impossible.length) {
      warnings.push(`${day.name || day.isoDate}: ${impossible.length} ${impossible.length === 1 ? 'osoba ma' : 'osoby mają'} ponad 24 h dyżurów.`);
    }
  });
  return warnings;
}

function normalizeShift(shift) {
  const parsed = parseHoursLabel(shift.hours || `${shift.start || ''}–${shift.end || ''}`);
  return {
    type: shift.type || 'dyzur',
    label: shift.label || 'Dyżur',
    hours: shift.hours || parsed.hours,
    start: shift.start || parsed.start,
    end: shift.end || parsed.end,
    duration: numberOr(shift.duration, shift.hoursValue || parsed.duration),
    sourceGroup: shift.sourceGroup || shift.label || '',
    groupKey: shift.groupKey || '',
    groupLabel: shift.groupLabel || '',
    groupOrder: numberOr(shift.groupOrder, 0),
    replacesPerson: shift.replacesPerson || shift.zmieniam || shift.replaces || shift.previousPerson || '',
    replacedByPerson: shift.replacedByPerson || shift.zmienia || shift.replacedBy || shift.nextPerson || '',
    zmieniam: shift.zmieniam || shift.replacesPerson || '',
    zmienia: shift.zmienia || shift.replacedByPerson || ''
  };
}

function notifyAlerts(alerts) {
  const first = alerts[0];
  toast(first.message || 'Wykryto korektę grafiku.');
  if ('Notification' in window && Notification.permission === 'granted') {
    alerts.slice(0, 3).forEach(alert => new Notification('Harmonogram MOW — korekta grafiku', { body: alert.message || `${alert.range}: ${alert.filename}`, tag: alert.id }));
  }
}

function render() {
  $('lastSync').textContent = state.lastSync ? `Ostatnia aktualizacja: ${formatDateTime(state.lastSync)} • widok: ${state.educator || 'Dymek'} • kalendarz: tylko ${state.calendarEducator || 'Dymek'}` : 'Brak połączenia z backendem. Możesz załadować dane testowe.';
  renderSecurityNotice();
  renderBackendDiagnostics();
  renderAlerts();
  renderTodayCard();
  renderChangesPanel();
  renderTabs();
  renderWeek();
  renderHistory();
}

function renderSecurityNotice() {
  const target = $('securityNotice');
  if (!target) return;
  const security = state.security || {};
  const hasTokens = Boolean(state.viewToken || state.adminToken);
  const warning = security.publicWarning || (!hasTokens && state.backendUrl ? 'Nie wpisano tokenu. Jeśli backend ma być udostępniony, ustaw tokeny w Apps Script.' : '');
  if (!warning && !state.adminToken) {
    target.innerHTML = '<section class="card info-card"><strong>Tryb podglądu.</strong><span> Ta aplikacja nie zapisze nic do Kalendarza Google bez ADMIN_TOKEN.</span></section>';
    return;
  }
  if (!warning && state.adminToken) {
    target.innerHTML = '<section class="card success-card"><strong>Tryb administratora.</strong><span> Synchronizacja może skanować Gmail i aktualizować Kalendarz tylko dla Dymka.</span></section>';
    return;
  }
  target.innerHTML = `<section class="card warning-card"><strong>Bezpieczeństwo:</strong><span> ${escapeHtml(warning)}</span></section>`;
}

function renderBackendDiagnostics() {
  const target = $('backendDiagnostics');
  if (!target) return;
  if (!state.backendError) { target.innerHTML = ''; return; }
  const testUrl = state.backendUrl ? buildPublicTestUrl(backendUrlWithParams('ping')) : '';
  target.innerHTML = `<section class="card danger-card"><h2>Błąd połączenia z backendem</h2><p>${escapeHtml(state.backendError)}</p><ol class="diagnostic-list"><li>Adres musi kończyć się na <strong>/exec</strong>, nie na /dev.</li><li>Aplikacja wymusza konto Google <strong>authuser=0</strong>, aby wiele zalogowanych kont nie kierowało żądania do błędnego profilu.</li><li>W Apps Script ustaw wdrożenie: <strong>Wykonaj jako: Ja</strong> oraz <strong>Kto ma dostęp: Każdy</strong>.</li><li>Po zmianie backendu zrób: <strong>Wdróż → Zarządzaj wdrożeniami → Edytuj → Nowa wersja → Wdróż</strong>.</li><li>Blokada skryptów, prywatny DNS lub filtr antywirusowy nie mogą blokować <strong>script.google.com</strong> ani <strong>googleusercontent.com</strong>.</li></ol>${testUrl ? `<a class="diagnostic-link" target="_blank" rel="noopener" href="${escapeHtml(testUrl)}">Otwórz test backendu</a>` : ''}</section>`;
}

function renderAlerts() {
  const alerts = state.alerts || [];
  const target = $('alertsView');
  if (!alerts.length) { target.innerHTML = ''; return; }
  target.innerHTML = `<section class="card alert-card"><h2>Ostrzeżenia o zmianach</h2>${alerts.slice(0, 5).map(alert => `<div class="alert-item"><strong>${escapeHtml(alert.type === 'correction' ? 'Korekta grafiku' : 'Nowy grafik')}</strong><span>${escapeHtml(alert.message || '')}</span><small>${escapeHtml(alert.subject || '')}</small></div>`).join('')}</section>`;
}

function renderTabs() {
  const target = $('weekTabs');
  if (!target) return;
  const weeks = state.weeks || [];
  if (!weeks.length) {
    target.innerHTML = '';
    return;
  }
  const visibleCount = Math.min(3, weeks.length);
  const maxOffset = Math.max(0, weeks.length - visibleCount);
  state.weekTabOffset = Math.min(Math.max(Number(state.weekTabOffset || 0), 0), maxOffset);
  if (state.activeTab < state.weekTabOffset || state.activeTab >= state.weekTabOffset + visibleCount) {
    state.weekTabOffset = getWeekTabOffsetForActive(state.activeTab, weeks.length);
  }
  const visibleWeeks = weeks.slice(state.weekTabOffset, state.weekTabOffset + visibleCount);
  target.innerHTML = `
    <button class="tab-arrow" type="button" data-week-nav="-1" aria-label="Poprzedni tydzień" ${state.activeTab <= 0 ? 'disabled' : ''}>‹</button>
    <div class="tab-strip">
      ${visibleWeeks.map((week, visibleIndex) => {
        const index = state.weekTabOffset + visibleIndex;
        const relation = getWeekRelationLabel(week, index);
        return `<button class="tab ${index === state.activeTab ? 'active' : ''}" type="button" data-index="${index}">${escapeHtml(relation)}<small>${escapeHtml(week.range || `${week.dateFrom} – ${week.dateTo}`)}</small></button>`;
      }).join('')}
    </div>
    <button class="tab-arrow" type="button" data-week-nav="1" aria-label="Następny tydzień" ${state.activeTab >= weeks.length - 1 ? 'disabled' : ''}>›</button>
  `;
  target.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    state.activeTab = Number(btn.dataset.index);
    state.weekTabOffset = getWeekTabOffsetForActive(state.activeTab, weeks.length);
    persist();
    render();
    if (state.dayFilter === 'internat') ensureInternatWeekLoaded();
  }));
  target.querySelectorAll('[data-week-nav]').forEach(btn => btn.addEventListener('click', () => {
    const step = Number(btn.dataset.weekNav || 0);
    state.activeTab = Math.min(Math.max(Number(state.activeTab || 0) + step, 0), weeks.length - 1);
    state.weekTabOffset = getWeekTabOffsetForActive(state.activeTab, weeks.length);
    persist();
    render();
    if (state.dayFilter === 'internat') ensureInternatWeekLoaded();
  }));
}

function getPreferredWeekIndex(weeks = []) {
  if (!weeks.length) return 0;
  const today = startOfLocalDay(new Date());
  const currentIndex = weeks.findIndex(week => {
    const range = getWeekDateRange(week);
    return range.start && range.end && range.start <= today && range.end >= today;
  });
  if (currentIndex >= 0) return currentIndex;
  const nextIndex = weeks.findIndex(week => {
    const range = getWeekDateRange(week);
    return range.start && range.start > today;
  });
  return nextIndex >= 0 ? nextIndex : weeks.length - 1;
}

function getWeekTabOffsetForActive(activeIndex, totalWeeks) {
  const visibleCount = Math.min(3, totalWeeks || 0);
  if (!visibleCount) return 0;
  const maxOffset = Math.max(0, totalWeeks - visibleCount);
  return Math.min(Math.max(Number(activeIndex || 0) - 1, 0), maxOffset);
}

function getWeekRelationLabel(week, index) {
  const range = getWeekDateRange(week);
  const today = startOfLocalDay(new Date());
  if (range.start && range.end && range.start <= today && range.end >= today) return 'Bieżący';
  if (range.end && range.end < today) {
    const lastPastIndex = (state.weeks || []).reduce((found, item, itemIndex) => {
      const itemRange = getWeekDateRange(item);
      return itemRange.end && itemRange.end < today ? itemIndex : found;
    }, -1);
    return index === lastPastIndex ? 'Poprzedni' : (week.label || 'Archiwalny');
  }
  const futureWeeks = (state.weeks || []).filter(item => {
    const itemRange = getWeekDateRange(item);
    return itemRange.start && itemRange.start > today;
  });
  const futureIndex = futureWeeks.findIndex(item => item === week);
  if (futureIndex === 0) return 'Następny';
  if (futureIndex === 1) return 'Kolejny';
  if (futureIndex > 1) return `Za ${futureIndex + 1} tyg.`;
  return week.label || 'Tydzień';
}

function getActiveWeek() {
  if (!state.weeks.length) return null;
  return state.weeks[Math.min(Math.max(Number(state.activeTab || 0), 0), state.weeks.length - 1)] || null;
}

function getWeekCacheKey(week) {
  return String((week && (week.weekStart || week.dateFrom)) || '');
}

async function ensureInternatWeekLoaded() {
  const week = getActiveWeek();
  const weekStart = getWeekCacheKey(week);
  if (!week || !weekStart || state.internatWeeks?.[weekStart]) return;
  if (!state.backendUrl) {
    render();
    toast('Widok całego internatu wymaga połączenia z backendem albo danych testowych zawierających pełny plan.');
    return;
  }
  if (internatWeekRequests.has(weekStart)) return internatWeekRequests.get(weekStart);

  const request = (async () => {
    render();
    try {
      const payload = await requestBackend(backendUrlWithParams('internat', { weekStart }));
      if (payload?.ok === false) throw new Error(payload.error || 'backend zwrócił ok=false');
      const rawWeek = payload?.data?.internatWeek || payload?.internatWeek;
      if (!rawWeek || !Array.isArray(rawWeek.days)) throw new Error('backend nie zwrócił pełnego planu internatu');
      state.internatWeeks = { ...(state.internatWeeks || {}), [weekStart]: normalizeInternatWeek(rawWeek) };
      state.backendError = '';
      persist();
      render();
      toast('Pobrano plan całego internatu dla wybranego tygodnia.');
    } catch (error) {
      state.backendError = error.message;
      persist();
      render();
      toast('Nie udało się pobrać planu całego internatu: ' + error.message);
    } finally {
      internatWeekRequests.delete(weekStart);
    }
  })();
  internatWeekRequests.set(weekStart, request);
  return request;
}

function renderWeek() {
  if (!state.weeks.length) {
    $('weekView').innerHTML = '<section class="card"><p class="empty">Brak danych. Wpisz backend albo załaduj dane testowe.</p></section>';
    return;
  }
  const week = getActiveWeek();
  if (state.dayFilter === 'internat') {
    renderInternatWeek(week);
    return;
  }
  const s = week.summary || {};
  const noPlan = week.hasData && week.hasEducatorPlan === false ? `<p class="warning-line">W tym dokumencie nie znaleziono dyżurów dla: ${escapeHtml(state.educator || '')}.</p>` : '';
  const visibleDays = filterDays(week.days || []);
  const emptyFilter = visibleDays.length ? '' : '<section class="card"><p class="empty">Brak dni pasujących do wybranego filtra.</p></section>';
  $('weekView').innerHTML = `<section class="card week-head"><div class="week-heading-copy"><p class="eyebrow">${escapeHtml(week.label || 'Tydzień')}</p><h2>${escapeHtml(week.range || `${week.dateFrom} – ${week.dateTo}`)}</h2><p class="hint">${escapeHtml(week.source || 'Źródło: Gmail / dokument internatu')}</p>${noPlan}</div><div class="metrics"><div class="metric"><span>Godziny</span><strong>${numberOr(s.totalHours, 0)}</strong></div><div class="metric"><span>Nadgodziny</span><strong>${numberOr(s.overtimeHours, 0)}</strong></div><div class="metric"><span>Weekend h</span><strong>${numberOr(s.weekendHours, 0)}</strong></div><div class="metric"><span>Dni weekend</span><strong>${numberOr(s.weekendWorkDays, 0)}</strong></div></div></section>${emptyFilter || `<section class="days">${visibleDays.map(renderDay).join('')}</section>`}`;
}

function renderInternatWeek(selectedWeek) {
  const weekStart = getWeekCacheKey(selectedWeek);
  const fullWeek = state.internatWeeks?.[weekStart];
  if (!fullWeek) {
    const loading = internatWeekRequests.has(weekStart);
    const message = loading
      ? 'Pobieram pełny plan internatu dla tego tygodnia…'
      : (state.backendUrl
        ? 'Pełny plan nie został jeszcze pobrany. Wybierz ponownie „Cały internat” albo użyj „Pobierz / synchronizuj teraz”.'
        : 'Pełny plan internatu wymaga skonfigurowanego backendu.');
    $('weekView').innerHTML = `<section class="card internat-placeholder"><p class="eyebrow">Cały internat</p><h2>${escapeHtml(selectedWeek.range || `${selectedWeek.dateFrom} – ${selectedWeek.dateTo}`)}</h2><p class="empty">${escapeHtml(message)}</p></section>`;
    return;
  }

  const source = fullWeek.source || selectedWeek.source || 'Dokument internatu';
  const validationNotice = fullWeek.validationWarnings?.length
    ? `<section class="card danger-card internat-validation"><strong>Dane wymagają ponownego odczytu.</strong><span>${escapeHtml(fullWeek.validationWarnings.join(' '))}</span></section>`
    : '';
  $('weekView').innerHTML = `
    <section class="card week-head internat-head">
      <div class="week-heading-copy">
        <p class="eyebrow">Cały internat • ${escapeHtml(selectedWeek.label || 'Tydzień')}</p>
        <h2>${escapeHtml(fullWeek.range || selectedWeek.range || `${selectedWeek.dateFrom} – ${selectedWeek.dateTo}`)}</h2>
        <p class="hint">${escapeHtml(source)}</p>
      </div>
      <div class="metrics internat-metrics">
        <div class="metric"><span>Osoby</span><strong>${numberOr(fullWeek.staffCount, 0)}</strong></div>
        <div class="metric"><span>Dyżury</span><strong>${numberOr(fullWeek.shiftCount, 0)}</strong></div>
        <div class="metric"><span>Łącznie h</span><strong>${numberOr(fullWeek.totalHours, 0)}</strong></div>
      </div>
    </section>
    ${validationNotice}
    <section class="internat-days">${(fullWeek.days || []).map(renderInternatDay).join('')}</section>`;
}

function renderInternatDay(day) {
  const groups = groupInternatShifts(day.shifts || []);
  const shiftCount = (day.shifts || []).length;
  const isToday = day.isoDate === toLocalIsoDate(new Date());
  const groupPanels = groups.map(group => {
    const shifts = group.shifts.map(renderInternatShift).join('') || '<p class="empty">Brak dyżurów.</p>';
    return `<details class="internat-group"><summary><div><strong>${escapeHtml(group.label)}</strong><span>${formatDutyCount(group.shifts.length)}</span></div><span>${numberOr(group.hours, 0)} h</span></summary><div class="internat-shift-list">${shifts}</div></details>`;
  }).join('') || '<p class="empty internat-day-empty">Brak dyżurów.</p>';
  return `<details class="internat-day ${day.weekend ? 'weekend' : ''}"${isToday ? ' open' : ''}><summary><div class="internat-day-title"><strong>${escapeHtml(day.name)}</strong><span>${escapeHtml(day.date)}</span></div><div class="internat-day-stats"><span>${escapeHtml(formatInternatSectionSummary(groups))}</span><span>${formatDutyCount(shiftCount)}</span><strong>${numberOr(day.hoursDay, 0)} h</strong></div></summary><div class="internat-day-body">${groupPanels}</div></details>`;
}

function renderInternatShift(shift) {
  const relation = [
    shift.replacesPerson ? `zmienia: ${shift.replacesPerson}` : '',
    shift.replacedByPerson ? `przekazuje: ${shift.replacedByPerson}` : ''
  ].filter(Boolean).join(' • ');
  return `<div class="internat-shift ${shiftClassName(shift.type)}"><strong class="internat-hours">${escapeHtml(shift.hours)}</strong><div class="internat-person"><strong>${escapeHtml(shift.educator)}</strong><span>${escapeHtml(shift.label || 'Dyżur')}${relation ? ` • ${escapeHtml(relation)}` : ''}</span></div></div>`;
}

function groupInternatShifts(shifts = []) {
  const groups = new Map();
  shifts.forEach(shift => {
    const group = getInternatShiftGroup(shift);
    if (!groups.has(group.key)) groups.set(group.key, { ...group, shifts: [], hours: 0 });
    const target = groups.get(group.key);
    target.shifts.push(shift);
    target.hours = round(target.hours + numberOr(shift.duration, 0));
  });
  return Array.from(groups.values()).sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'pl'));
}

function getInternatShiftGroup(shift = {}) {
  const explicitKey = String(shift.groupKey || '').trim();
  const explicitLabel = String(shift.groupLabel || '').trim();
  if (explicitKey && explicitLabel) return { key: explicitKey, label: explicitLabel, order: numberOr(shift.groupOrder, 50) };

  const text = [shift.sourceGroup, shift.label, explicitKey, explicitLabel].filter(Boolean).join(' ');
  if (String(shift.type || '').toLowerCase() === 'noc' || /(^|\s)noc(?:\s|$)/i.test(text)) {
    return { key: 'night', label: 'Noc', order: 90 };
  }

  const vacationMatch = text.match(/\bgrupa\s+([ab])\b/i);
  if (vacationMatch) {
    const letter = vacationMatch[1].toUpperCase();
    return { key: `vacation-${letter.toLowerCase()}`, label: `Grupa ${letter}`, order: letter === 'A' ? 1 : 2 };
  }

  const groupMatch = text.match(/(?:\bzast\.\s*)?\b(?:grupa|gr\.)\s*(VIII|VII|VI|IV|V|III|II|I|[1-8])\b/i);
  if (groupMatch) {
    const number = romanGroupNumber(groupMatch[1]);
    return { key: `group-${number}`, label: `Grupa ${number}`, order: number };
  }

  return { key: 'other', label: 'Pozostałe', order: 99 };
}

function romanGroupNumber(value) {
  const normalized = String(value || '').toUpperCase();
  const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
  return roman[normalized] || Math.min(Math.max(Number(normalized) || 0, 1), 8);
}

function formatGroupCount(count) {
  if (count === 1) return '1 grupa';
  if (count >= 2 && count <= 4) return `${count} grupy`;
  return `${count} grup`;
}

function formatInternatSectionSummary(groups = []) {
  const groupCount = groups.filter(group => /^group-|^vacation-/.test(group.key)).length;
  const extras = [];
  if (groups.some(group => group.key === 'night')) extras.push('Noc');
  if (groups.some(group => group.key === 'other')) extras.push('pozostałe');
  return [formatGroupCount(groupCount), ...extras].join(' + ');
}

function formatDutyCount(count) {
  if (count === 1) return '1 dyżur';
  if (count >= 2 && count <= 4) return `${count} dyżury`;
  return `${count} dyżurów`;
}

function renderDay(day) {
  const shifts = day.shifts.length ? day.shifts.map(renderShift).join('') : '<p class="empty">Wolne / brak wpisu</p>';
  const warnings = (day.warnings || []).map(w => `<div class="day-warning">${escapeHtml(w)}</div>`).join('');
  const changes = (day.changes || []).map(change => `<div class="day-change"><strong>Zmiana:</strong> ${escapeHtml(change.message || change)}</div>`).join('');
  const flags = `${day.hasChange ? '<span class="badge change-badge">Zmiana</span>' : ''}${(day.warnings || []).length ? '<span class="badge warn-badge">Uwaga</span>' : ''}`;
  return `<article class="day-card ${day.weekend ? 'weekend' : ''} ${day.hasChange ? 'changed' : ''}"><div class="day-top"><div><div class="day-name">${escapeHtml(day.name)}</div><div class="day-flags">${flags}</div></div><div class="day-date">${escapeHtml(day.date)}</div></div>${warnings}${changes}${shifts}<div class="day-total"><span>Razem: ${numberOr(day.hoursDay, 0)} h</span>${day.zmienia && day.zmienia !== '–' ? `<span class="total-right">Zmienia mnie: ${escapeHtml(day.zmienia)}</span>` : ''}</div></article>`;
}

function renderShift(shift) {
  const replaces = shift.replacesPerson || shift.zmieniam || '';
  const replacedBy = shift.replacedByPerson || shift.zmienia || '';
  return `<div class="shift ${shiftClassName(shift.type)}"><div class="shift-line"><span class="label">${escapeHtml(shift.label)}</span>${replaces ? `<span class="relief-right">Zmieniam: ${escapeHtml(replaces)}</span>` : ''}</div><strong class="hours">${escapeHtml(shift.hours)}</strong><div class="shift-meta-row"><span class="meta">${numberOr(shift.duration, 0)} h</span>${replacedBy ? `<span class="relief-right">Zmienia mnie: ${escapeHtml(replacedBy)}</span>` : ''}</div></div>`;
}

function renderHistory() {
  if (state.shareMode === 'limited') { $('historyView').innerHTML = '<p class="empty">Historia ukryta w trybie uproszczonego udostępniania.</p>'; return; }
  const rows = state.history || [];
  if (!rows.length) { $('historyView').innerHTML = '<p class="empty">Brak historii.</p>'; return; }
  $('historyView').innerHTML = `<table class="history-table"><thead><tr><th>Tydzień</th><th>Godz.</th><th>Nadg.</th><th>Weekend</th><th>Dni</th></tr></thead><tbody>${rows.map(row => `<tr><td data-label="Tydzień">${escapeHtml(row.range || `${row.dateFrom || row.weekStart} – ${row.dateTo || row.weekEnd}`)}</td><td data-label="Godz.">${numberOr(row.totalHours, 0)}</td><td data-label="Nadg.">${numberOr(row.overtimeHours, 0)}</td><td data-label="Weekend">${numberOr(row.weekendHours, 0)}</td><td data-label="Dni">${numberOr(row.weekendWorkDays, 0)}</td></tr>`).join('')}</tbody></table>`;
}

function exportHistoryCsv() {
  const rows = [['Wychowawca', state.educator || ''], [], ['Tydzień', 'Godziny', 'Nadgodziny', 'Godziny weekend', 'Dni weekend']].concat((state.history || []).map(r => [r.range || `${r.dateFrom || r.weekStart} - ${r.dateTo || r.weekEnd}`, r.totalHours, r.overtimeHours, r.weekendHours, r.weekendWorkDays]));
  const csv = rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `historia-godzin-${slug(state.educator || 'wychowawca')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


function renderTodayCard() {
  const target = $('todayView');
  if (!target) return;
  const todayIso = toLocalIsoDate(new Date());
  const allDays = (state.weeks || []).flatMap(week => (week.days || []).map(day => ({ ...day, weekRange: week.range })));
  const today = allDays.find(day => day.isoDate === todayIso);
  const future = allDays.filter(day => day.isoDate >= todayIso && (day.shifts || []).length).sort((a, b) => String(a.isoDate).localeCompare(String(b.isoDate)))[0];
  const chosen = today || future;
  if (!chosen) { target.innerHTML = '<section class="card today-card"><h2>Najbliższy dyżur</h2><p class="empty">Brak dyżurów w pobranych tygodniach.</p></section>'; return; }
  const isToday = chosen.isoDate === todayIso;
  const shifts = (chosen.shifts || []).map(shift => `<li><strong>${escapeHtml(shift.hours)}</strong> — ${escapeHtml(shift.label)} (${numberOr(shift.duration, 0)} h)</li>`).join('') || '<li>Wolne / brak wpisu</li>';
  target.innerHTML = `<section class="card today-card"><p class="eyebrow">${isToday ? 'Dzisiaj' : 'Najbliższy dyżur'}</p><h2>${escapeHtml(chosen.label || chosen.name)} ${escapeHtml(chosen.date || chosen.isoDate)}</h2><ul>${shifts}</ul>${(chosen.warnings || []).map(w => `<div class="day-warning">${escapeHtml(w)}</div>`).join('')}</section>`;
}

function renderChangesPanel() {
  const target = $('changesView');
  if (!target) return;
  const active = state.weeks[Math.min(state.activeTab || 0, Math.max((state.weeks || []).length - 1, 0))];
  const activeChanges = active && active.changes ? active.changes : [];
  const fallbackChanges = (state.changes || []).filter(ch => active && ch.weekStart === active.weekStart);
  const changes = activeChanges.length ? activeChanges : fallbackChanges;
  const alerts = (state.alerts || []).filter(alert => !active || alert.weekStart === active.weekStart).slice(0, 4);
  if (!changes.length && !alerts.length) { target.innerHTML = ''; return; }
  const changeRows = changes.slice(0, 12).map(ch => `<div class="change-row"><strong>${escapeHtml(ch.dayName || ch.date || 'Zmiana')}</strong><span>${escapeHtml(ch.message || '')}</span>${ch.before || ch.after ? `<small>Było: ${escapeHtml(ch.before || '—')} → Jest: ${escapeHtml(ch.after || '—')}</small>` : ''}</div>`).join('');
  const alertRows = alerts.map(alert => `<div class="change-row alert-row"><strong>${escapeHtml(alert.type === 'correction' ? 'Korekta' : 'Nowy grafik')}</strong><span>${escapeHtml(alert.message || '')}</span><small>${escapeHtml(alert.previousFilename ? `Poprzednio: ${alert.previousFilename}` : alert.subject || '')}</small></div>`).join('');
  target.innerHTML = `<section class="card changes-card"><h2>Zmiany względem poprzedniej wersji</h2>${changeRows || ''}${alertRows || ''}</section>`;
}

function renderEducatorDatalist() {
  const list = $('educatorList');
  if (!list) return;
  const names = Array.from(new Set([state.educator || 'Dymek', ...(state.availableEducators || [])].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pl'));
  list.innerHTML = names.map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
}

function filterDays(days) {
  const filter = state.dayFilter || 'all';
  if (filter === 'work') return days.filter(day => numberOr(day.hoursDay, 0) > 0);
  if (filter === 'changed') return days.filter(day => day.hasChange || (day.changes || []).length);
  if (filter === 'warnings') return days.filter(day => (day.warnings || []).length);
  return days;
}

function detectDayWarnings(shifts, incoming, index) {
  const warnings = [];
  const hasNight = (shifts || []).some(shift => String(shift.type).toLowerCase() === 'noc' || /22:00|23:00/.test(shift.hours || '') && /06:00/.test(shift.hours || ''));
  const early = (shifts || []).some(shift => /^0?[6-8]:/.test(shift.start || '') || /^0?[6-8]:/.test(String(shift.hours || '')));
  const longDay = numberOr(incoming.hoursDay, (shifts || []).reduce((s, sh) => s + numberOr(sh.duration, 0), 0)) >= 10;
  if (hasNight && early) warnings.push('Noc i poranny wpis w tym samym dniu — sprawdź odpoczynek.');
  if (longDay) warnings.push('Długi dzień pracy: co najmniej 10 godzin.');
  if (index >= 5 && (shifts || []).length) warnings.push('Praca w weekend.');
  return warnings;
}

function collectChangesFromWeeks(weeks) {
  return (weeks || []).flatMap(week => (week.changes || []).map(ch => ({ ...ch, weekStart: week.weekStart, range: week.range })));
}

function printCurrentWeekPdf() {
  setTimeout(() => window.print(), 50);
}

async function copyShareSummary() {
  const lines = [];
  lines.push('Harmonogram MOW — podgląd');
  lines.push('Wychowawca: ' + (state.educator || ''));
  lines.push('Backend: ' + (state.backendUrl || ''));
  lines.push('Uwaga: udostępniaj tylko VIEW_TOKEN, nigdy ADMIN_TOKEN.');
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Skopiowano krótki opis podglądu. Token VIEW wklej osobno tylko zaufanej osobie.');
  } catch {
    toast('Nie udało się skopiować do schowka.');
  }
}

const DAYS = [{ key: 'mon', name: 'PON' }, { key: 'tue', name: 'WT' }, { key: 'wed', name: 'ŚR' }, { key: 'thu', name: 'CZW' }, { key: 'fri', name: 'PT' }, { key: 'sat', name: 'SOB' }, { key: 'sun', name: 'ND' }];
function weekToHistoryRow(week) { return { range: week.range, dateFrom: week.dateFrom, dateTo: week.dateTo, ...(week.summary || {}) }; }
function sortHistoryRows(rows = []) { return [...rows].sort((a, b) => compareWeekLikeAsc(b, a)); }
function compareWeekLikeAsc(a, b) {
  const ar = getWeekDateRange(a);
  const br = getWeekDateRange(b);
  if (ar.start && br.start) return ar.start - br.start;
  return String(a?.range || a?.dateFrom || a?.weekStart || '').localeCompare(String(b?.range || b?.dateFrom || b?.weekStart || ''), 'pl');
}
function getWeekDateRange(week = {}) {
  const start = parseLocalDate(week.dateFrom || week.weekStart) || parseFirstDateFromRange(week.range);
  const end = parseLocalDate(week.dateTo || week.weekEnd) || parseLastDateFromRange(week.range, start);
  return { start: start ? startOfLocalDay(start) : null, end: end ? startOfLocalDay(end) : null };
}
function parseFirstDateFromRange(range = '') {
  const dates = parseDatesFromText(range);
  return dates[0] || null;
}
function parseLastDateFromRange(range = '', firstDate = null) {
  const dates = parseDatesFromText(range, firstDate?.getFullYear());
  if (!dates.length) return null;
  const last = dates[dates.length - 1];
  if (firstDate && last < firstDate) last.setFullYear(firstDate.getFullYear() + 1);
  return last;
}
function parseDatesFromText(text = '', fallbackYear = new Date().getFullYear()) {
  return [...String(text || '').matchAll(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/g)]
    .map(match => parseLocalDate(match[0], fallbackYear))
    .filter(Boolean);
}
function parseLocalDate(value = '', fallbackYear = new Date().getFullYear()) {
  const text = String(value || '').trim();
  if (!text) return null;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isSameLocalDate(date, Number(iso[1]), Number(iso[2]), Number(iso[3])) ? date : null;
  }
  const dotted = text.match(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/);
  if (!dotted) return null;
  const rawYear = dotted[3] ? Number(dotted[3]) : fallbackYear;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(year, Number(dotted[2]) - 1, Number(dotted[1]));
  return isSameLocalDate(date, year, Number(dotted[2]), Number(dotted[1])) ? date : null;
}
function isSameLocalDate(date, year, month, day) { return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day; }
function startOfLocalDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function parseHoursLabel(label) { const match = String(label).match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/); if (!match) return { hours: label, start: '', end: '', duration: 0 }; const duration = durationHours(match[1], match[2]); return { hours: `${match[1]}–${match[2]}`, start: match[1], end: match[2], duration }; }
function durationHours(start, end) { const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number); let minutes = (eh * 60 + em) - (sh * 60 + sm); if (minutes <= 0) minutes += 24 * 60; return round(minutes / 60); }
function addDaysIso(iso, offset) { const date = parseLocalDate(iso); if (!date) return ''; date.setDate(date.getDate() + offset); return toLocalIsoDate(date); }
function formatShortDate(iso) { const [y, m, d] = String(iso || '').split('-'); return d && m ? `${d}.${m}` : ''; }
function formatDateTime(iso) { const date = new Date(iso); return Number.isNaN(date.getTime()) ? 'brak danych' : new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(date); }
function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? round(n) : fallback; }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function firstNonEmpty(items) { for (const value of items || []) { const text = String(value || '').trim(); if (text && text !== '–') return text; } return ''; }
function lastNonEmpty(items) { for (let i = (items || []).length - 1; i >= 0; i--) { const text = String(items[i] || '').trim(); if (text && text !== '–') return text; } return ''; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function slug(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wychowawca'; }
function shiftClassName(value) { const allowed = ['dyzur', 'noc', 'vi', 'zast', 'wakacje']; const normalized = slug(value); return allowed.includes(normalized) ? normalized : 'dyzur'; }
function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function iframeBridge(baseUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const bridgeNonce = createBridgeNonce();
    url.searchParams.set('transport', 'bridge');
    url.searchParams.set('bridgeNonce', bridgeNonce);
    url.searchParams.delete('callback');
    url.searchParams.set('_', String(Date.now()));

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0';
    iframe.setAttribute('aria-hidden', 'true');

    let completed = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('brak komunikatu postMessage z Apps Script. Najczęściej działa jeszcze stara wersja backendu albo telefon trzyma starą PWA/cache'));
    }, 60000);

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }

    function onMessage(event) {
      if (!isExpectedBridgeMessage(event, iframe.contentWindow, bridgeNonce)) return;
      const data = event.data;
      completed = true;
      cleanup();
      resolve(data.payload);
    }

    iframe.onerror = () => {
      if (completed) return;
      cleanup();
      reject(new Error('iframe nie załadował Apps Script'));
    };

    window.addEventListener('message', onMessage);
    iframe.src = url.toString();
    document.body.appendChild(iframe);
  });
}

function jsonp(baseUrl) {
  return new Promise((resolve, reject) => {
    const callbackName = `harmonogramCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = new URL(baseUrl);
    url.searchParams.set('callback', callbackName);
    url.searchParams.delete('transport');
    url.searchParams.set('format', 'jsonp');
    const script = document.createElement('script');
    let completed = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('brak odpowiedzi JSONP z Apps Script. Najczęściej wdrożenie nie ma dostępu „Każdy” albo telefon używa starej wersji PWA'));
    }, 60000);
    function cleanup() {
      clearTimeout(timer);
      try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[callbackName] = (payload) => {
      completed = true;
      cleanup();
      resolve(payload);
    };
    script.onerror = () => {
      if (completed) return;
      cleanup();
      reject(new Error('nie udało się załadować odpowiedzi Apps Script jako JSONP. Aplikacja używa mostu iframe/postMessage; adres musi kończyć się na /exec, wdrożenie musi być najnowszą wersją i telefon nie może trzymać starego cache'));
    };
    script.onload = () => {
      setTimeout(() => {
        if (!completed) {
          cleanup();
          reject(new Error('Apps Script odpowiedział, ale nie wywołał callback JSONP. To zwykle oznacza starą wersję backendu albo ekran logowania Google zamiast JavaScript'));
        }
      }, 250);
    };
    script.async = true;
    script.src = url.toString();
    document.head.appendChild(script);
  });
}
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast._timer); toast._timer = setTimeout(() => el.classList.remove('show'), 5200); }
