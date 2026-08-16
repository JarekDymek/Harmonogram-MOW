import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
const results = [];

async function test(name, callback) {
  await callback();
  results.push(name);
}

await test('pliki JSON i składnia JavaScript', () => {
  JSON.parse(read('package.json'));
  const manifest = JSON.parse(read('manifest.webmanifest'));
  JSON.parse(read('data/sample-weeks.json'));
  assert.equal(manifest.id, './');
  assert.equal(manifest.lang, 'pl');
  assert.ok(manifest.icons.some(icon => icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  manifest.icons.forEach(icon => assert.ok(fs.existsSync(path.join(projectRoot, icon.src)), `Brak ikony ${icon.src}`));
  new vm.Script(read('assets/app.js'), { filename: 'assets/app.js' });
  new vm.Script(read('service-worker.js'), { filename: 'service-worker.js' });
  new vm.Script(read('apps-script/Code.gs'), { filename: 'apps-script/Code.gs' });
});

await test('spójność identyfikatorów HTML używanych przez frontend', () => {
  const html = read('index.html');
  const app = read('assets/app.js');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'index.html zawiera zduplikowane id');
  const referenced = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]));
  for (const id of referenced) assert.ok(ids.includes(id), `Brak elementu #${id} w index.html`);
});

await test('funkcje dat, URL i normalizacji frontendu', () => {
  const app = read('assets/app.js');
  const start = app.indexOf('function normalizeBackendUrl');
  assert.ok(start > 0, 'Nie znaleziono funkcji frontendu do testów');
  const context = vm.createContext({ URL, Intl, Date, console, setTimeout, clearTimeout, Blob });
  new vm.Script(`${app.slice(start)}\n    globalThis.frontend = { normalizeBackendUrl, parseLocalDate, addDaysIso, durationHours, normalizeWeek, escapeHtml, formatDateTime, toLocalIsoDate };`
  ).runInContext(context);
  const api = context.frontend;

  assert.equal(api.normalizeBackendUrl('https://script.google.com/macros/s/ABC/dev?x=1'), 'https://script.google.com/macros/s/ABC/exec');
  assert.throws(() => api.normalizeBackendUrl('https://example.com/macros/s/ABC/exec'), /script\.google\.com/);
  assert.equal(api.parseLocalDate('31.02.2026'), null);
  assert.equal(api.addDaysIso('2026-03-28', 2), '2026-03-30');
  assert.equal(api.durationHours('22:00', '06:00'), 8);
  assert.equal(api.escapeHtml('<img src=x>'), '&lt;img src=x&gt;');
  assert.equal(api.formatDateTime('nie-data'), 'brak danych');

  const normalized = api.normalizeWeek({
    dateFrom: '2026-08-10',
    summary: { totalHours: 999 },
    days: [{ hoursDay: 2, shifts: [] }]
  });
  assert.equal(normalized.summary.totalHours, 2, 'Wyliczona suma godzin musi być nadrzędna wobec starego podsumowania');
});

class MockBlob {
  constructor(value) { this.bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); }
  getBytes() { return [...this.bytes]; }
  getDataAsString() { return this.bytes.toString('utf8'); }
}

function formatInTimeZone(date, timeZone, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  if (pattern === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
  if (pattern === 'dd.MM') return `${parts.day}.${parts.month}`;
  if (pattern === 'dd.MM.yyyy') return `${parts.day}.${parts.month}.${parts.year}`;
  if (pattern === 'HH:mm') return `${parts.hour}:${parts.minute}`;
  throw new Error(`Nieobsługiwany format testowy: ${pattern}`);
}

function createAppsScriptContext() {
  const properties = {};
  const calendarEvents = [];
  const calendarOperations = [];
  let nextEventId = 1;
  const scriptProperties = {
    getProperty: key => Object.hasOwn(properties, key) ? properties[key] : null,
    setProperty: (key, value) => { properties[key] = String(value); return scriptProperties; },
    deleteProperty: key => { delete properties[key]; return scriptProperties; },
    getProperties: () => ({ ...properties })
  };
  const Calendar = { Events: {
    list: () => ({ items: calendarEvents.map(event => ({ ...event })) }),
    insert: event => {
      calendarOperations.push('insert');
      const stored = { ...event, id: `event-${nextEventId++}` };
      calendarEvents.push(stored);
      return stored;
    },
    patch: (patch, calendarId, eventId) => {
      calendarOperations.push('patch');
      const event = calendarEvents.find(item => item.id === eventId);
      Object.assign(event, patch);
      return event;
    },
    remove: (calendarId, eventId) => {
      calendarOperations.push('remove');
      const index = calendarEvents.findIndex(item => item.id === eventId);
      if (index >= 0) calendarEvents.splice(index, 1);
    }
  } };

  const context = vm.createContext({
    console, Date, Intl, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Error, isFinite,
    Calendar,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Europe/Warsaw' },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (algorithm, bytes) => [...crypto.createHash('sha256').update(Buffer.from(bytes)).digest()],
      newBlob: value => new MockBlob(typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)),
      gzip: blob => new MockBlob(zlib.gzipSync(Buffer.from(blob.getBytes()))),
      ungzip: blob => new MockBlob(zlib.gunzipSync(Buffer.from(blob.getBytes()))),
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64Decode: value => [...Buffer.from(value, 'base64')],
      formatDate: formatInTimeZone,
      getUuid: () => crypto.randomUUID()
    }
  });
  return { context, properties, scriptProperties, calendarEvents, calendarOperations };
}

await test('testy regresji parsera Apps Script', () => {
  const { context } = createAppsScriptContext();
  new vm.Script(read('apps-script/Code.gs'), { filename: 'apps-script/Code.gs' }).runInContext(context);
  new vm.Script(read('apps-script/ParserTests.gs'), { filename: 'apps-script/ParserTests.gs' }).runInContext(context);
  new vm.Script('runParserTests();').runInContext(context);
});

await test('duże dane Apps Script są kompresowane, dzielone i odtwarzane', () => {
  const runtime = createAppsScriptContext();
  new vm.Script(read('apps-script/Code.gs'), { filename: 'apps-script/Code.gs' }).runInContext(runtime.context);
  runtime.context.largePayload = [{ rawText: crypto.randomBytes(50000).toString('base64'), educator: 'Dymek' }];
  new vm.Script(`
    setLargeJsonProperty_('test:large', largePayload);
    globalThis.restoredPayload = getLargeJsonProperty_('test:large');
  `).runInContext(runtime.context);
  assert.deepEqual(runtime.context.restoredPayload, runtime.context.largePayload);
  const storedValues = Object.values(runtime.properties);
  assert.ok(storedValues.length > 2, 'Duży zapis powinien zostać podzielony na wiele właściwości');
  assert.ok(storedValues.every(value => Buffer.byteLength(value, 'utf8') < 9000), 'Wartość przekracza limit 9 KB Apps Script');

  new vm.Script("deleteLargeJsonProperty_('test:large');").runInContext(runtime.context);
  assert.equal(Object.keys(runtime.properties).filter(key => key.startsWith('test:large')).length, 0);
});

await test('backend domyślnie blokuje dostęp bez skonfigurowanych tokenów', () => {
  const runtime = createAppsScriptContext();
  new vm.Script(read('apps-script/Code.gs'), { filename: 'apps-script/Code.gs' }).runInContext(runtime.context);
  new vm.Script("globalThis.accessResult = requireAccess_({}, 'view');").runInContext(runtime.context);
  assert.equal(runtime.context.accessResult.ok, false);
  runtime.scriptProperties.setProperty('VIEW_TOKEN', 'view_test');
  runtime.scriptProperties.setProperty('ADMIN_TOKEN', 'admin_test');
  new vm.Script("globalThis.accessResult = requireAccess_({ token: 'view_test' }, 'view');").runInContext(runtime.context);
  assert.equal(runtime.context.accessResult.ok, true);
  assert.equal(runtime.context.accessResult.level, 'view');
});

await test('synchronizacja kalendarza jest idempotentna i nie usuwa przed wstawieniem', () => {
  const runtime = createAppsScriptContext();
  new vm.Script(read('apps-script/Code.gs'), { filename: 'apps-script/Code.gs' }).runInContext(runtime.context);
  runtime.calendarEvents.push({
    id: 'legacy', summary: 'Praca MOW — Dymek', location: 'MOW',
    description: 'HARMONOGRAM_APP=1\nHARMONOGRAM_EDUCATOR=Dymek\nHARMONOGRAM_WEEK=2026-08-10'
  });
  new vm.Script(`
    globalThis.calendarView = {
      hasData: true, source: 'grafik.docx',
      days: [{ shifts: [{ type: 'vi', label: 'Gr. VI', startIso: '2026-08-10T12:00:00.000Z', endIso: '2026-08-10T18:00:00.000Z' }] }]
    };
    buildWeekView_ = function () { return calendarView; };
    globalThis.firstSync = syncWeekToCalendar_('2026-08-10');
    globalThis.secondSync = syncWeekToCalendar_('2026-08-10');
  `).runInContext(runtime.context);
  assert.deepEqual(runtime.calendarOperations.slice(0, 2), ['insert', 'remove']);
  assert.equal(runtime.context.firstSync.inserted, 1);
  assert.equal(runtime.context.firstSync.removed, 1);
  assert.equal(runtime.context.secondSync.inserted, 0);
  assert.equal(runtime.context.secondSync.removed, 0);
  assert.equal(runtime.context.secondSync.unchanged, 1);
});

await test('service worker nie przechwytuje obcych i nieznanych zasobów', async () => {
  const handlers = {};
  const deleted = [];
  const cachesMock = {
    keys: async () => ['harmonogram-mow-shell-old', 'inna-aplikacja'],
    delete: async key => { deleted.push(key); return true; },
    match: async () => new Response('offline'),
    open: async () => ({ addAll: async () => {}, put: async () => {} })
  };
  const selfMock = {
    registration: { scope: 'https://example.test/app/' },
    location: { origin: 'https://example.test' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (name, callback) => { handlers[name] = callback; }
  };
  let failNetwork = false;
  const context = vm.createContext({
    self: selfMock, caches: cachesMock, URL, Set, Response, Request,
    fetch: async () => { if (failNetwork) throw new Error('offline'); return new Response('ok'); }
  });
  new vm.Script(read('service-worker.js'), { filename: 'service-worker.js' }).runInContext(context);

  let intercepted = false;
  handlers.fetch({ request: new Request('https://script.google.com/macros/s/ABC/exec'), respondWith: () => { intercepted = true; }, waitUntil() {} });
  assert.equal(intercepted, false);
  handlers.fetch({ request: new Request('https://example.test/app/nieznany.bin'), respondWith: () => { intercepted = true; }, waitUntil() {} });
  assert.equal(intercepted, false);

  failNetwork = true;
  let sampleResponse;
  handlers.fetch({
    request: new Request('https://example.test/app/data/sample-weeks.json', { cache: 'no-store' }),
    respondWith: promise => { sampleResponse = promise; },
    waitUntil() {}
  });
  assert.equal(await (await sampleResponse).text(), 'offline');

  let activation;
  handlers.activate({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ['harmonogram-mow-shell-old']);
});

console.log(`OK — ${results.length} zestawów testów`);
for (const name of results) console.log(`  ✓ ${name}`);
