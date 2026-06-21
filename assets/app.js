const STORAGE_KEY = 'harmonogram-mow-state-v12';
const LEGACY_STORAGE_KEYS = ['harmonogram-mow-state-v11', 'harmonogram-mow-state-v10', 'harmonogram-mow-state-v9', 'harmonogram-mow-state-v8'];
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
  availableEducators: [],
  seenAlertIds: [],
  lastSync: null,
  activeTab: 1,
  weekTabOffset: 0,
  backendError: ''
};

const $ = (id) => document.getElementById(id);
let deferredInstallPrompt = null;
let state = loadState();
if (state.weeks && state.weeks.length) {
  state.activeTab = getPreferredWeekIndex(state.weeks);
  state.weekTabOffset = getWeekTabOffsetForActive(state.activeTab, state.weeks.length);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $('installBtn').classList.remove('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('installBtn').classList.add('hidden');
});

$('refreshBtn').addEventListener('click', refreshFromBackend);
$('settingsBtn').addEventListener('click', () => $('settingsPanel').classList.toggle('hidden'));
$('sampleBtn').addEventListener('click', loadSampleData);
$('dashboardBtn').addEventListener('click', loadDashboardOnly);
const testBackendBtn = $('testBackendBtn');
if (testBackendBtn) testBackendBtn.addEventListener('click', testBackendConnection);
$('saveSettingsBtn').addEventListener('click', saveSettings);
$('clearCacheBtn').addEventListener('click', clearCache);
$('exportBtn').addEventListener('click', exportHistoryCsv);
$('notifyBtn').addEventListener('click', enableNotifications);
const dayFilterEl = $('dayFilter');
if (dayFilterEl) dayFilterEl.addEventListener('change', () => { state.dayFilter = dayFilterEl.value || 'all'; persist(); render(); });
const printBtn = $('printBtn');
if (printBtn) printBtn.addEventListener('click', printCurrentWeekPdf);
const shareViewBtn = $('shareViewBtn');
if (shareViewBtn) shareViewBtn.addEventListener('click', copyShareSummary);
const educatorInput = $('educator');
if (educatorInput) educatorInput.addEventListener('change', () => { state.educator = educatorInput.value.trim() || 'Dymek'; persist(); render(); });

hydrateSettings();
render();
if (!state.weeks.length) loadSampleData(false);

function loadState() {
  const keys = [STORAGE_KEY].concat(LEGACY_STORAGE_KEYS || []);
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) || {};
      const merged = { ...DEFAULT_STATE, ...parsed };
      if (Array.isArray(merged.weeks)) merged.weeks = merged.weeks.sort(compareWeekLikeAsc);
      if (Array.isArray(merged.history)) merged.history = sortHistoryRows(merged.history);
      if (key !== STORAGE_KEY) localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return merged;
    } catch {}
  }
  return { ...DEFAULT_STATE };
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function hydrateSettings() {
  $('backendUrl').value = state.backendUrl || '';
  $('viewToken').value = state.viewToken || '';
  $('adminToken').value = state.adminToken || '';
  $('layoutMode').value = state.layoutMode || 'auto';
  if ($('shareMode')) $('shareMode').value = state.shareMode || 'full';
  if ($('dayFilter')) $('dayFilter').value = state.dayFilter || 'all';
  $('educator').value = state.educator || 'Dymek';
  renderEducatorDatalist();
  applyLayoutMode();
}

function normalizeBackendUrl(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  v = v.replace(/\s+/g, '');
  v = v.replace(/\/dev(?:\?.*)?$/, '/exec');
  const qIndex = v.indexOf('?');
  if (qIndex !== -1) v = v.slice(0, qIndex);
  return v;
}

function saveSettings() {
  state.backendUrl = normalizeBackendUrl($('backendUrl').value.trim());
  state.viewToken = $('viewToken').value.trim();
  state.adminToken = $('adminToken').value.trim();
  state.layoutMode = $('layoutMode').value || 'auto';
  state.shareMode = $('shareMode') ? ($('shareMode').value || 'full') : 'full';
  state.dayFilter = $('dayFilter') ? ($('dayFilter').value || 'all') : 'all';
  state.educator = $('educator').value.trim() || 'Dymek';
  applyLayoutMode();
  persist();
  const mode = state.adminToken ? 'tryb administratora' : (state.viewToken ? 'tryb podglądu' : 'bez tokenu');
  toast('Ustawienia zapisane. Widok: ' + state.educator + '. ' + mode + '. Kalendarz: tylko ' + (state.calendarEducator || 'Dymek') + '.');
  render();
}

function applyLayoutMode() {
  const mode = state.layoutMode || 'auto';
  document.documentElement.dataset.layout = mode;
}

function backendUrlWithParams(action) {
  const url = new URL(state.backendUrl);
  url.searchParams.set('action', action);
  url.searchParams.set('educator', state.educator || 'Dymek');
  if (state.adminToken) url.searchParams.set('token', state.adminToken);
  else if (state.viewToken) url.searchParams.set('token', state.viewToken);
  url.searchParams.set('transport', 'bridge');
  url.searchParams.set('_', String(Date.now()));
  return url;
}

function clearCache() {
  localStorage.removeItem(STORAGE_KEY);
  state = { ...DEFAULT_STATE };
  hydrateSettings();
  render();
  toast('Wyczyszczono lokalne dane.');
}

async function enableNotifications() {
  if (!('Notification' in window)) { toast('Ta przeglądarka nie obsługuje powiadomień.'); return; }
  const permission = await Notification.requestPermission();
  toast(permission === 'granted' ? 'Powiadomienia włączone.' : 'Powiadomienia nie zostały włączone.');
}

async function loadSampleData(showToast = true) {
  const response = await fetch('./data/sample-weeks.json', { cache: 'no-store' });
  const payload = await response.json();
  applyPayload(payload);
  if (showToast) toast('Załadowano dane testowe.');
}

async function refreshFromBackend() {
  saveSettings();
  if (!state.backendUrl) {
    toast('Najpierw wpisz adres backendu Apps Script w ustawieniach.');
    $('settingsPanel').classList.remove('hidden');
    return;
  }
  try {
    const action = state.adminToken ? 'sync' : 'dashboard';
    toast(state.adminToken ? 'Synchronizuję Gmail i Kalendarz…' : 'Pobieram widok z backendu bez zapisu do kalendarza…');
    const payload = await requestBackend(backendUrlWithParams(action));
    state.backendError = '';
    const dashboard = extractDashboard(payload);
    applyPayload(dashboard);
    const suffix = (state.educator || 'Dymek') === (state.calendarEducator || 'Dymek') ? '' : ' Kalendarz Google pozostał tylko dla ' + (state.calendarEducator || 'Dymek') + '.';
    toast((state.adminToken ? 'Synchronizacja zakończona.' : 'Widok pobrany.') + suffix);
  } catch (error) {
    state.backendError = error.message;
    persist();
    render();
    toast(`Błąd backendu: ${error.message}`);
  }
}

async function loadDashboardOnly() {
  saveSettings();
  if (!state.backendUrl) {
    toast('Najpierw wpisz adres backendu Apps Script w ustawieniach.');
    $('settingsPanel').classList.remove('hidden');
    return;
  }
  try {
    toast('Pobieram dane bez synchronizacji kalendarza…');
    const payload = await requestBackend(backendUrlWithParams('dashboard'));
    state.backendError = '';
    applyPayload(extractDashboard(payload));
    toast('Widok pobrany. Nic nie zapisano do Kalendarza Google.');
  } catch (error) {
    toast(`Błąd backendu: ${error.message}`);
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
        '. Otwórz link testu backendu. Jeśli widzisz JSON z ok:true albo ok:false, backend działa, a problem był w starej PWA/cache.'
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
  saveSettings();
  if (!state.backendUrl) {
    toast('Najpierw wpisz adres backendu /exec.');
    return;
  }
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
  return { weeks, history, alerts: cleanSource.alerts || [], changes: cleanSource.changes || collectChangesFromWeeks(weeks), availableEducators: cleanSource.availableEducators || [], updatedAt: cleanSource.updatedAt || cleanSource.generatedAt, educator: cleanSource.educator, calendarEducator: cleanSource.calendarEducator, security: cleanSource.security || {} };
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
  return { ...week, days, summary: { totalHours, overtimeHours: Math.max(0, round(totalHours - 24)), weekendHours, weekendWorkDays: days.filter(d => d.weekend && d.hoursDay > 0).length, ...(week.summary || {}) } };
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
  target.innerHTML = `<section class="card danger-card"><h2>Błąd połączenia z backendem</h2><p>${escapeHtml(state.backendError)}</p><ol class="diagnostic-list"><li>Adres musi kończyć się na <strong>/exec</strong>, nie na /dev.</li><li>W Apps Script ustaw wdrożenie: <strong>Wykonaj jako: Ja</strong> oraz <strong>Kto ma dostęp: Każdy</strong>.</li><li>Po każdej zmianie kodu zrób: <strong>Wdróż → Zarządzaj wdrożeniami → Edytuj → Nowa wersja → Wdróż</strong>.</li><li>Na telefonie wyczyść dane PWA albo odinstaluj i zainstaluj ponownie.</li></ol>${testUrl ? `<a class="diagnostic-link" target="_blank" rel="noopener" href="${escapeHtml(testUrl)}">Otwórz test backendu</a>` : ''}</section>`;
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
  }));
  target.querySelectorAll('[data-week-nav]').forEach(btn => btn.addEventListener('click', () => {
    const step = Number(btn.dataset.weekNav || 0);
    state.activeTab = Math.min(Math.max(Number(state.activeTab || 0) + step, 0), weeks.length - 1);
    state.weekTabOffset = getWeekTabOffsetForActive(state.activeTab, weeks.length);
    persist();
    render();
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

function renderWeek() {
  if (!state.weeks.length) {
    $('weekView').innerHTML = '<section class="card"><p class="empty">Brak danych. Wpisz backend albo załaduj dane testowe.</p></section>';
    return;
  }
  const week = state.weeks[Math.min(state.activeTab, state.weeks.length - 1)];
  const s = week.summary || {};
  const noPlan = week.hasData && week.hasEducatorPlan === false ? `<p class="warning-line">W tym dokumencie nie znaleziono dyżurów dla: ${escapeHtml(state.educator || '')}.</p>` : '';
  const visibleDays = filterDays(week.days || []);
  const emptyFilter = visibleDays.length ? '' : '<section class="card"><p class="empty">Brak dni pasujących do wybranego filtra.</p></section>';
  $('weekView').innerHTML = `<section class="card week-head"><div><p class="eyebrow">${escapeHtml(week.label || 'Tydzień')}</p><h2>${escapeHtml(week.range || `${week.dateFrom} – ${week.dateTo}`)}</h2><p class="hint">${escapeHtml(week.source || 'Źródło: Gmail / dokument internatu')}</p>${noPlan}</div><div class="metrics"><div class="metric"><span>Godziny</span><strong>${numberOr(s.totalHours, 0)}</strong></div><div class="metric"><span>Nadgodziny</span><strong>${numberOr(s.overtimeHours, 0)}</strong></div><div class="metric"><span>Weekend h</span><strong>${numberOr(s.weekendHours, 0)}</strong></div><div class="metric"><span>Dni weekend</span><strong>${numberOr(s.weekendWorkDays, 0)}</strong></div></div></section>${emptyFilter || `<section class="days">${visibleDays.map(renderDay).join('')}</section>`}`;
}

function renderDay(day) {
  const shifts = day.shifts.length ? day.shifts.map(renderShift).join('') : '<p class="empty">Wolne / brak wpisu</p>';
  const warnings = (day.warnings || []).map(w => `<div class="day-warning">${escapeHtml(w)}</div>`).join('');
  const changes = (day.changes || []).map(change => `<div class="day-change"><strong>Zmiana:</strong> ${escapeHtml(change.message || change)}</div>`).join('');
  const flags = `${day.hasChange ? '<span class="badge change-badge">Zmiana</span>' : ''}${(day.warnings || []).length ? '<span class="badge warn-badge">Uwaga</span>' : ''}`;
  return `<article class="day-card ${day.weekend ? 'weekend' : ''} ${day.hasChange ? 'changed' : ''}"><div class="day-top"><div><div class="day-name">${day.name}</div><div class="day-flags">${flags}</div></div><div class="day-date">${day.date}</div></div>${warnings}${changes}${shifts}<div class="day-total"><span>Razem: ${numberOr(day.hoursDay, 0)} h</span>${day.zmienia && day.zmienia !== '–' ? `<span class="total-right">Zmienia mnie: ${escapeHtml(day.zmienia)}</span>` : ''}</div></article>`;
}

function renderShift(shift) {
  const replaces = shift.replacesPerson || shift.zmieniam || '';
  const replacedBy = shift.replacedByPerson || shift.zmienia || '';
  return `<div class="shift ${escapeHtml(shift.type)}"><div class="shift-line"><span class="label">${escapeHtml(shift.label)}</span>${replaces ? `<span class="relief-right">Zmieniam: ${escapeHtml(replaces)}</span>` : ''}</div><strong class="hours">${escapeHtml(shift.hours)}</strong><div class="shift-meta-row"><span class="meta">${numberOr(shift.duration, 0)} h</span>${replacedBy ? `<span class="relief-right">Zmienia mnie: ${escapeHtml(replacedBy)}</span>` : ''}</div></div>`;
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
  const todayIso = new Date().toISOString().slice(0, 10);
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
  document.body.classList.add('print-week');
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
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dotted = text.match(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/);
  if (!dotted) return null;
  const rawYear = dotted[3] ? Number(dotted[3]) : fallbackYear;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(year, Number(dotted[2]) - 1, Number(dotted[1]));
  return Number.isNaN(date.getTime()) ? null : date;
}
function startOfLocalDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function parseHoursLabel(label) { const match = String(label).match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/); if (!match) return { hours: label, start: '', end: '', duration: 0 }; const duration = durationHours(match[1], match[2]); return { hours: `${match[1]}–${match[2]}`, start: match[1], end: match[2], duration }; }
function durationHours(start, end) { const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number); let minutes = (eh * 60 + em) - (sh * 60 + sm); if (minutes <= 0) minutes += 24 * 60; return round(minutes / 60); }
function addDaysIso(iso, offset) { const date = new Date(`${iso}T00:00:00`); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }
function formatShortDate(iso) { const [y, m, d] = String(iso || '').split('-'); return d && m ? `${d}.${m}` : ''; }
function formatDateTime(iso) { return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)); }
function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? round(n) : fallback; }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function firstNonEmpty(items) { for (const value of items || []) { const text = String(value || '').trim(); if (text && text !== '–') return text; } return ''; }
function lastNonEmpty(items) { for (let i = (items || []).length - 1; i >= 0; i--) { const text = String(items[i] || '').trim(); if (text && text !== '–') return text; } return ''; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function slug(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wychowawca'; }
function iframeBridge(baseUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    url.searchParams.set('transport', 'bridge');
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
      const data = event.data;
      if (!data || data.source !== 'harmonogram-mow-backend') return;
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
    let loaded = false;
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
      loaded = true;
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
