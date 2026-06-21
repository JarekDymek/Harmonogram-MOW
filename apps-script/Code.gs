const CONFIG = {
  appName: 'Harmonogram MOW',
  backendVersion: '2026-06-21-stored-weeks',
  securityMode: 'token',
  sourceEmail: 'dgorski5@wp.pl',
  calendarId: 'primary',
  defaultEducator: 'Dymek',
  calendarEducator: 'Dymek',
  baseWeeklyHours: 24,
  scanQueryDays: 45,
  historyWeeks: 12,
  maxThreads: 30,
  maxAttachmentsPerRun: 35,
  maxDocsPerWeek: 5,
  maxAlerts: 30,
  scanPastDays: 21,
  scanFutureDays: 35,
  dashboardWeekOffsets: [-7, 0, 7, 14],
  triggerMinutes: 30,
  aliases: {
    Dymek: ['Dymek', 'Jarek Dymek', 'Jarosław Dymek', 'J. Dymek']
  },
  days: [
    { key: 'mon', short: 'PON', label: 'Poniedziałek', offset: 0, weekend: false },
    { key: 'tue', short: 'WT', label: 'Wtorek', offset: 1, weekend: false },
    { key: 'wed', short: 'ŚR', label: 'Środa', offset: 2, weekend: false },
    { key: 'thu', short: 'CZW', label: 'Czwartek', offset: 3, weekend: false },
    { key: 'fri', short: 'PT', label: 'Piątek', offset: 4, weekend: false },
    { key: 'sat', short: 'SOB', label: 'Sobota', offset: 5, weekend: true },
    { key: 'sun', short: 'ND', label: 'Niedziela', offset: 6, weekend: true }
  ]
};

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = String(params.action || 'dashboard');
  const callback = params.callback || '';
  const transport = String(params.transport || params.format || '').toLowerCase();
  const educator = normalizeEducatorInput_(params.educator || CONFIG.defaultEducator);
  const adminActions = { sync: true, scan: true, forceRescan: true, clearAllStoredWeeks: true };
  const requiredLevel = adminActions[action] ? 'admin' : 'view';
  const access = requireAccess_(params, requiredLevel);

  if (!access.ok) {
    return jsonOutput_({
      ok: false,
      error: access.error,
      security: access.publicInfo,
      data: null,
      weeks: [],
      history: [],
      alerts: []
    }, callback, transport);
  }

  try {
    if (action === 'ping') {
      const dashboard = getDashboardData(educator);
      return jsonOutput_(backendResponse_(dashboard, null, { status: 'ready', action: 'ping', access: access }), callback, transport);
    }

    if (action === 'sync' || action === 'scan') {
      const scanResult = scanAndSync();
      const dashboard = getDashboardData(educator);
      return jsonOutput_(backendResponse_(dashboard, scanResult, { action: action, access: access }), callback, transport);
    }

    if (action === 'forceRescan') {
      const scanResult = forceRescan();
      const dashboard = getDashboardData(educator);
      return jsonOutput_(backendResponse_(dashboard, scanResult, { action: 'forceRescan', access: access }), callback, transport);
    }

    if (action === 'dashboard') {
      const dashboard = getDashboardData(educator);
      return jsonOutput_(backendResponse_(dashboard, null, { action: 'dashboard', access: access }), callback, transport);
    }

    return jsonOutput_({ ok: false, error: 'Nieznana akcja: ' + action, data: null, weeks: [], history: [], alerts: [] }, callback, transport);
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message, stack: err.stack, data: null, weeks: [], history: [], alerts: [] }, callback, transport);
  }
}

function backendResponse_(dashboard, scanResult, extra) {
  dashboard = dashboard || {};
  extra = extra || {};
  return {
    ok: true,
    status: extra.status || 'ok',
    action: extra.action || '',
    data: dashboard,
    result: scanResult,
    appName: dashboard.appName || CONFIG.appName,
    educator: dashboard.educator || CONFIG.defaultEducator,
    calendarEducator: CONFIG.calendarEducator,
    calendarSyncLocked: true,
    generatedAt: dashboard.generatedAt || new Date().toISOString(),
    updatedAt: dashboard.generatedAt || new Date().toISOString(),
    weeks: dashboard.weeks || [],
    history: dashboard.history || [],
    alerts: dashboard.alerts || [],
    scan: scanResult || null,
    security: getSecurityPublicInfo_(extra.access)
  };
}


function setupSecurityTokens() {
  const props = PropertiesService.getScriptProperties();
  const viewToken = generateToken_('view');
  const adminToken = generateToken_('admin');
  props.setProperty('VIEW_TOKEN', viewToken);
  props.setProperty('ADMIN_TOKEN', adminToken);
  Logger.log('VIEW_TOKEN=' + viewToken);
  Logger.log('ADMIN_TOKEN=' + adminToken);
  Logger.log('W aplikacji dla zwykłego podglądu wpisz tylko VIEW_TOKEN. ADMIN_TOKEN zostaw wyłącznie u siebie.');
  return { viewToken: viewToken, adminToken: adminToken };
}

function clearSecurityTokens() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('VIEW_TOKEN');
  props.deleteProperty('ADMIN_TOKEN');
  Logger.log('Usunięto VIEW_TOKEN i ADMIN_TOKEN. Backend będzie działał w trybie otwartym, dopóki nie uruchomisz setupSecurityTokens().');
}

function requireAccess_(params, level) {
  const security = getSecurityConfig_();
  const token = String(params.token || params.viewToken || params.adminToken || '').trim();
  const publicInfo = getSecurityPublicInfo_({ level: level });

  if (!security.enabled) {
    return { ok: true, level: 'open', publicInfo: publicInfo };
  }

  if (security.adminToken && safeEqual_(token, security.adminToken)) {
    return { ok: true, level: 'admin', publicInfo: publicInfo };
  }

  if (level === 'view' && security.viewToken && safeEqual_(token, security.viewToken)) {
    return { ok: true, level: 'view', publicInfo: publicInfo };
  }

  return {
    ok: false,
    error: level === 'admin'
      ? 'Brak uprawnień administracyjnych. Ta akcja wymaga ADMIN_TOKEN.'
      : 'Brak dostępu. Wpisz poprawny VIEW_TOKEN albo ADMIN_TOKEN.',
    publicInfo: publicInfo
  };
}

function getSecurityConfig_() {
  const props = PropertiesService.getScriptProperties();
  const viewToken = String(props.getProperty('VIEW_TOKEN') || '').trim();
  const adminToken = String(props.getProperty('ADMIN_TOKEN') || '').trim();
  return {
    enabled: Boolean(viewToken || adminToken),
    viewToken: viewToken,
    adminToken: adminToken
  };
}

function getSecurityPublicInfo_(access) {
  const security = getSecurityConfig_();
  return {
    tokenProtectionEnabled: security.enabled,
    accessLevel: access && access.level ? access.level : '',
    calendarWritesOnlyFor: CONFIG.calendarEducator,
    publicWarning: security.enabled ? '' : 'UWAGA: tokeny nie są ustawione. Backend jest otwarty dla osób znających adres /exec.'
  };
}

function generateToken_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function safeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function doPost(e) { return doGet(e); }

function install() {
  deleteExistingTriggers_('scanAndSync');
  ScriptApp.newTrigger('scanAndSync').timeBased().everyMinutes(CONFIG.triggerMinutes).create();
  return forceRescan();
}

function forceRescan() {
  clearProcessedMarkers_();
  const result = scanAndSync();
  Logger.log('FORCE RESCAN SUMMARY: threads=' + result.threads +
    ', messages=' + result.messagesSeen +
    ', seen=' + result.attachmentsSeen +
    ', attempted=' + result.attachmentsAttempted +
    ', processed=' + result.attachmentsProcessed +
    ', ignored=' + result.attachmentsIgnored +
    ', skippedWindow=' + result.attachmentsSkippedByWindow +
    ', skippedLimit=' + result.attachmentsSkippedByLimit +
    ', changedWeeks=' + result.changedWeeks.join(',') +
    ', alerts=' + result.alertsCreated +
    ', errors=' + result.errors.length);
  return result;
}

function scanAndSync() {
  const scanResult = scanMailbox_();
  scanResult.changedWeeks.forEach(function (weekStart) {
    syncWeekToCalendar_(weekStart);
  });
  return scanResult;
}

function manualRefresh() {
  scanAndSync();
  return getDashboardData(CONFIG.defaultEducator);
}

function getDashboardData(educator) {
  const who = normalizeEducatorInput_(educator || CONFIG.defaultEducator);
  const currentMonday = mondayOf_(new Date());
  const dashboardWeekStarts = getDashboardWeekStarts_(currentMonday);
  const weeks = dashboardWeekStarts.map(function (weekStart) {
    return buildWeekView_(weekStart, who);
  });
  const changes = [].concat.apply([], weeks.map(function (week) { return week.changes || []; }));
  return {
    appName: CONFIG.appName,
    backendVersion: CONFIG.backendVersion,
    educator: who,
    calendarEducator: CONFIG.calendarEducator,
    calendarSyncLocked: true,
    sourceEmail: CONFIG.sourceEmail,
    calendarId: CONFIG.calendarId,
    generatedAt: new Date().toISOString(),
    dashboardWeekOffsets: CONFIG.dashboardWeekOffsets,
    dashboardWeekStarts: dashboardWeekStarts,
    weeks: weeks,
    history: buildHistory_(who),
    alerts: getAlerts_(),
    changes: changes,
    availableEducators: getAvailableEducators_()
  };
}

function getDashboardWeekStarts_(currentMonday) {
  const weekStarts = {};
  CONFIG.dashboardWeekOffsets.forEach(function (shiftDays) {
    weekStarts[toIsoDate_(addDays_(currentMonday, shiftDays))] = true;
  });
  getStoredWeekStarts_().forEach(function (weekStart) {
    if (isWeekInDashboardWindow_(weekStart)) weekStarts[weekStart] = true;
  });
  return Object.keys(weekStarts).sort();
}

function getStoredWeekStarts_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(props)
    .filter(function (key) { return key.indexOf('docs:') === 0; })
    .map(function (key) { return key.replace('docs:', ''); })
    .sort();
}

function isWeekInDashboardWindow_(weekStartIso) {
  const weekStart = parseIsoDate_(weekStartIso);
  const weekEnd = addDays_(weekStart, 6);
  const today = startOfDay_(new Date());
  const minDate = addDays_(today, -CONFIG.scanPastDays);
  const maxDate = addDays_(today, CONFIG.scanFutureDays);
  return weekEnd >= minDate && weekStart <= maxDate;
}

function scanMailbox_() {
  const query = ['from:' + CONFIG.sourceEmail, '(grafik OR grafiki OR harmonogram OR aktualizacja OR korekta OR zastępstwo)', 'has:attachment', 'newer_than:' + CONFIG.scanQueryDays + 'd'].join(' ');
  Logger.log('GmailApp query: ' + query);
  Logger.log('Okno skanowania tygodni: od ' + toIsoDate_(addDays_(startOfDay_(new Date()), -CONFIG.scanPastDays)) + ' do ' + toIsoDate_(addDays_(startOfDay_(new Date()), CONFIG.scanFutureDays)));

  const threads = GmailApp.search(query, 0, CONFIG.maxThreads);
  const props = PropertiesService.getScriptProperties();
  const changedWeeks = {};
  const ignored = [];
  const errors = [];
  const alerts = [];

  let messagesSeen = 0;
  let attachmentsSeen = 0;
  let attachmentsAttempted = 0;
  let attachmentsProcessed = 0;
  let attachmentsIgnored = 0;
  let attachmentsSkippedByWindow = 0;
  let attachmentsSkippedByLimit = 0;

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      messagesSeen++;
      try {
        const subject = message.getSubject() || '';
        const messageDate = message.getDate();
        const messageId = message.getId();
        const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });

        attachments.forEach(function (attachment) {
          const filename = htmlDecode_(attachment.getName() || '');
          const size = Number(attachment.getSize() || 0);
          if (!/\.docx$/i.test(filename)) return;
          attachmentsSeen++;

          if (attachmentsAttempted >= CONFIG.maxAttachmentsPerRun) {
            attachmentsSkippedByLimit++;
            Logger.log('SKIP LIMIT: ' + filename);
            return;
          }

          const explicitWeek = detectExplicitWeek_(filename, subject);
          if (explicitWeek && !isWeekInScanWindow_(explicitWeek.weekStart)) {
            attachmentsSkippedByWindow++;
            Logger.log('SKIP WINDOW: ' + filename + ' | week=' + explicitWeek.weekStart);
            return;
          }

          attachmentsAttempted++;
          const bytes = attachment.getBytes();
          const digest = sha256_(bytes);
          const key = ['processed', messageId, filename, size, digest].join(':');

          if (props.getProperty(key) === digest) {
            Logger.log('Pominięto już przetworzony załącznik: ' + filename);
            return;
          }

          const doc = parseDocxAttachmentToScheduleDocument_(attachment.copyBlob(), {
            messageId: messageId,
            subject: subject,
            messageDate: messageDate,
            filename: filename,
            size: size,
            digest: digest
          });

          props.setProperty(key, digest);

          if (!doc || doc.ignored) {
            attachmentsIgnored++;
            const reason = doc && doc.reason ? doc.reason : 'nieznany powód';
            const msg = filename + ' | ' + reason;
            ignored.push(msg);
            Logger.log('IGNORED: ' + msg);
            return;
          }

          if (!isWeekInScanWindow_(doc.weekStart)) {
            attachmentsSkippedByWindow++;
            Logger.log('SKIP WINDOW AFTER PARSE: ' + filename + ' | week=' + doc.weekStart);
            return;
          }

          const saveResult = saveScheduleDocument_(doc);
          if (saveResult.changed) {
            changedWeeks[doc.weekStart] = true;
          }
          if (saveResult.alert) {
            alerts.push(saveResult.alert);
          }
          attachmentsProcessed++;
          Logger.log('PROCESSED DOC: ' + doc.source.filename + ' | week=' + doc.weekStart + ' | priority=' + doc.source.priority + ' | kind=' + doc.source.kind);
        });
      } catch (err) {
        errors.push(message.getId() + ': ' + err.message);
        Logger.log('ERROR message ' + message.getId() + ': ' + err.stack);
      }
    });
  });

  return {
    ok: errors.length === 0,
    query: query,
    threads: threads.length,
    messagesSeen: messagesSeen,
    attachmentsSeen: attachmentsSeen,
    attachmentsAttempted: attachmentsAttempted,
    attachmentsProcessed: attachmentsProcessed,
    attachmentsIgnored: attachmentsIgnored,
    attachmentsSkippedByWindow: attachmentsSkippedByWindow,
    attachmentsSkippedByLimit: attachmentsSkippedByLimit,
    changedWeeks: Object.keys(changedWeeks).sort(),
    alertsCreated: alerts.length,
    alerts: alerts,
    ignored: ignored.slice(0, 20),
    errors: errors.slice(0, 20),
    calendarSyncedOnlyFor: CONFIG.calendarEducator
  };
}

function parseDocxAttachmentToScheduleDocument_(blob, source) {
  Logger.log('Konwertuję DOCX przez Drive + DocumentApp: ' + source.filename);
  const temp = Drive.Files.insert({ title: '[TMP] Harmonogram MOW - ' + source.filename, mimeType: MimeType.GOOGLE_DOCS }, blob, { convert: true });
  try {
    const text = DocumentApp.openById(temp.id).getBody().getText();
    const normalized = normalizeText_(text);
    const sourceScore = scoreScheduleSource_(source, normalized);
    if (sourceScore.priority <= 0) return { ignored: true, reason: sourceScore.reason };

    const week = detectWeek_(source.filename, source.subject, normalized, source.messageDate);
    const weekNumber = detectWeekNumber_(source.filename, normalized);

    return {
      ignored: false,
      weekNumber: weekNumber,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      dateFrom: week.dateFrom,
      dateTo: week.dateTo,
      rawText: normalized,
      source: {
        messageId: source.messageId,
        subject: source.subject,
        messageDate: source.messageDate.toISOString(),
        filename: source.filename,
        size: source.size,
        digest: source.digest,
        priority: sourceScore.priority,
        kind: sourceScore.kind,
        reason: sourceScore.reason
      },
      updatedAt: new Date().toISOString()
    };
  } finally {
    try { Drive.Files.trash(temp.id); } catch (err) { Logger.log('Nie udało się usunąć pliku tymczasowego: ' + err.message); }
  }
}

function scoreScheduleSource_(source, text) {
  const filename = String(source.filename || '');
  const subject = String(source.subject || '');
  const combined = normalizeName_(filename + ' ' + subject + ' ' + text.slice(0, 1200));
  const size = Number(source.size || 0);
  const hasInternat = /\bINTERNAT\b/i.test(text);
  const hasAnyGroup = /\n\s*(?:I|II|III|IV|V|VI|VII|VIII)\s*(?:\n|\s)/i.test(text);
  const hasVacationGroup = /\n\s*GRUPA\s+[A-Z]\s*(?:\n|\s)/i.test(text);
  const hasGroupVI = /\n\s*VI\s*(?:\n|\s)/i.test(text);
  const hasNight = /\n\s*NOC\s*(?:\n|\s)/i.test(text);
  const isCorrection = combined.indexOf('korekta') !== -1 || combined.indexOf('poprawka') !== -1 || combined.indexOf('zmiana') !== -1;
  const isCorrectionGr6 = isCorrection && (combined.indexOf('gr 6') !== -1 || combined.indexOf('grupa 6') !== -1 || combined.indexOf('gr vi') !== -1);
  const looksLikeTeamSchedule = combined.indexOf('grafik zespolu') !== -1 || combined.indexOf('godziny pracy zespolu') !== -1 || /Godziny pracy zespołu/i.test(text);

  if (looksLikeTeamSchedule && !hasInternat) return { priority: 0, kind: 'team-schedule', reason: 'to jest grafik zespołu, nie grafik internatu' };
  if (isCorrectionGr6 && hasGroupVI) return { priority: 100, kind: 'correction-gr6', reason: 'korekta grafiku Gr 6' };
  if (isCorrection && hasInternat && hasAnyGroup) return { priority: 96, kind: 'correction-internat', reason: 'korekta grafiku internatu' };
  if (hasInternat && hasVacationGroup) return { priority: hasNight ? 91 : 83, kind: 'internat-vacation', reason: 'wakacyjny grafik internatu' };
  if (hasInternat && hasAnyGroup) return { priority: hasNight ? 90 : 82, kind: 'internat', reason: 'pełny grafik internatu' };
  if (size >= 30000 && (hasAnyGroup || hasVacationGroup)) return { priority: 70, kind: 'large-schedule', reason: 'duży plik z grupami' };
  return { priority: 0, kind: 'unknown', reason: 'plik nie wygląda jak grafik internatu' };
}

function saveScheduleDocument_(doc) {
  const props = PropertiesService.getScriptProperties();
  const key = docsKey_(doc.weekStart);
  const oldDocs = getScheduleDocs_(doc.weekStart);
  const sameDigest = oldDocs.some(function (item) { return item.source && item.source.digest === doc.source.digest; });
  if (sameDigest) return { changed: false, alert: null };

  const previousTop = oldDocs.length ? oldDocs.slice().sort(compareDocs_)[0] : null;
  const docs = oldDocs.concat([doc]).sort(compareDocs_).slice(0, CONFIG.maxDocsPerWeek);
  props.setProperty(key, JSON.stringify(docs));
  pruneStoredDocs_();

  const newTop = docs[0];
  const topChanged = !previousTop || (newTop.source.digest !== previousTop.source.digest);
  const correction = isCorrectionDocument_(doc);
  let alert = null;

  if (topChanged && (correction || !previousTop || doc.source.priority >= Number(previousTop.source.priority || 0))) {
    alert = createChangeAlert_(doc, previousTop);
    addAlert_(alert);
  }

  Logger.log('Zapisano dokument tygodnia ' + doc.weekStart + ': ' + doc.source.filename + ', priority=' + doc.source.priority + ', docs=' + docs.length);
  return { changed: true, alert: alert };
}

function getScheduleDocs_(weekStart) {
  const raw = PropertiesService.getScriptProperties().getProperty(docsKey_(weekStart));
  if (!raw) return [];
  try {
    const docs = JSON.parse(raw);
    return Array.isArray(docs) ? docs : [];
  } catch (err) {
    return [];
  }
}

function docsKey_(weekStart) { return 'docs:' + weekStart; }

function compareDocs_(a, b) {
  const pa = a && a.source ? Number(a.source.priority || 0) : 0;
  const pb = b && b.source ? Number(b.source.priority || 0) : 0;
  if (pb !== pa) return pb - pa;
  const da = new Date(a && a.source ? a.source.messageDate || a.updatedAt || 0 : 0).getTime();
  const db = new Date(b && b.source ? b.source.messageDate || b.updatedAt || 0 : 0).getTime();
  return db - da;
}

function isCorrectionDocument_(doc) {
  const s = normalizeName_((doc.source.filename || '') + ' ' + (doc.source.subject || '') + ' ' + (doc.source.kind || ''));
  return s.indexOf('korekta') !== -1 || s.indexOf('poprawka') !== -1 || s.indexOf('zmiana') !== -1 || s.indexOf('correction') !== -1;
}

function createChangeAlert_(doc, previousTop) {
  const id = sha256_([doc.weekStart, doc.source.digest, doc.source.filename, doc.source.messageDate].join('|'));
  return {
    id: id,
    type: isCorrectionDocument_(doc) ? 'correction' : 'change',
    weekStart: doc.weekStart,
    weekEnd: doc.weekEnd,
    range: formatRange_(doc.weekStart),
    filename: doc.source.filename,
    subject: doc.source.subject,
    messageDate: doc.source.messageDate,
    previousFilename: previousTop && previousTop.source ? previousTop.source.filename : '',
    createdAt: new Date().toISOString(),
    message: (isCorrectionDocument_(doc) ? 'Wykryto korektę grafiku' : 'Wykryto nowy grafik') + ' dla tygodnia ' + formatRange_(doc.weekStart) + ': ' + doc.source.filename
  };
}

function addAlert_(alert) {
  if (!alert || !alert.id) return;
  const props = PropertiesService.getScriptProperties();
  const alerts = getAlerts_();
  if (alerts.some(function (item) { return item.id === alert.id; })) return;
  alerts.unshift(alert);
  props.setProperty('alerts', JSON.stringify(alerts.slice(0, CONFIG.maxAlerts)));
}

function getAlerts_() {
  const raw = PropertiesService.getScriptProperties().getProperty('alerts');
  if (!raw) return [];
  try {
    const alerts = JSON.parse(raw);
    return Array.isArray(alerts) ? alerts.slice(0, CONFIG.maxAlerts) : [];
  } catch (err) {
    return [];
  }
}

function pruneStoredDocs_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (key) {
    if (key.indexOf('docs:') !== 0) return;
    const weekStart = key.replace('docs:', '');
    if (!isWeekInScanWindow_(weekStart)) props.deleteProperty(key);
  });
}

function parseInternatSchedule_(text, weekStartIso, educator) {
  const who = normalizeEducatorInput_(educator || CONFIG.defaultEducator);
  const normalized = normalizeText_(text);
  const groupBlocks = extractGroupBlocks_(normalized);
  const vacationGroupBlocks = extractVacationGroupBlocks_(normalized);
  const days = makeEmptyDays_(weekStartIso);

  Object.keys(groupBlocks).forEach(function (groupName) {
    const groupLabel = 'Gr. ' + groupName;
    const block = groupBlocks[groupName];
    const tokens = extractShiftTokens_(block);
    const assigned = enrichTokensWithReliefInfo_(assignTokensToDays_(tokens));

    assigned.forEach(function (item) {
      if (!isSelectedEducator_(item.name, who)) return;
      const day = days[item.dayIndex];
      if (!day) return;
      const shift = buildShift_(weekStartIso, item.dayIndex, item.start, item.end, groupName === 'VI' ? 'vi' : 'zast', groupName === 'VI' ? groupLabel : 'Zast. ' + groupLabel);
      shift.personRaw = item.name;
      shift.replacesPerson = cleanReliefName_(item.replacesPerson || '');
      shift.replacedByPerson = cleanReliefName_(item.replacedByPerson || '');
      shift.zmieniam = shift.replacesPerson;
      shift.zmienia = shift.replacedByPerson;
      day.shifts.push(shift);
    });
  });

  Object.keys(vacationGroupBlocks).forEach(function (groupName) {
    const block = vacationGroupBlocks[groupName];
    const tokens = extractShiftTokens_(block);
    const assigned = enrichTokensWithReliefInfo_(assignTokensToDays_(tokens));

    assigned.forEach(function (item) {
      if (!isSelectedEducator_(item.name, who)) return;
      const day = days[item.dayIndex];
      if (!day) return;
      const shift = buildShift_(weekStartIso, item.dayIndex, item.start, item.end, 'wakacje', 'Grupa ' + groupName);
      shift.personRaw = item.name;
      shift.replacesPerson = cleanReliefName_(item.replacesPerson || '');
      shift.replacedByPerson = cleanReliefName_(item.replacedByPerson || '');
      shift.zmieniam = shift.replacesPerson;
      shift.zmienia = shift.replacedByPerson;
      day.shifts.push(shift);
    });
  });

  const nightBlock = extractNightBlock_(normalized);
  if (nightBlock) {
    const nightTokens = Object.keys(vacationGroupBlocks).length
      ? extractVacationNightTokens_(nightBlock)
      : extractShiftTokens_(nightBlock);
    nightTokens.forEach(function (item, index) {
      if (!isSelectedEducator_(item.name, who)) return;
      const dayIndex = typeof item.dayIndex === 'number' ? item.dayIndex : Math.min(index, 6);
      const day = days[dayIndex];
      if (!day) return;
      const shift = buildShift_(weekStartIso, dayIndex, item.start, item.end, 'noc', 'Noc');
      shift.personRaw = item.name;
      shift.replacesPerson = '';
      shift.replacedByPerson = '';
      shift.zmieniam = '';
      shift.zmienia = '';
      addShiftToDays_(days, shift);
    });
  }

  days.forEach(function (day) {
    day.shifts = dedupeShifts_(day.shifts);
    day.shifts.sort(function (a, b) { return a.startIso.localeCompare(b.startIso); });
    day.hoursDay = round2_(day.shifts.reduce(function (sum, shift) { return sum + shift.hoursValue; }, 0));
    day.zmieniam = firstNonEmpty_(day.shifts.map(function (shift) { return shift.replacesPerson || shift.zmieniam || ''; })) || '–';
    day.zmienia = lastNonEmpty_(day.shifts.map(function (shift) { return shift.replacedByPerson || shift.zmienia || ''; })) || '–';
  });

  return { days: days, totalHours: round2_(days.reduce(function (sum, day) { return sum + day.hoursDay; }, 0)) };
}

function addShiftToDays_(days, shift) {
  if (!shift || !shift.startIso || !shift.endIso) return;
  if (shift.type !== 'noc') {
    const dayIndex = findDayIndexByIso_(days, shift.startIso);
    if (dayIndex >= 0) days[dayIndex].shifts.push(shift);
    return;
  }

  const start = new Date(shift.startIso);
  const end = new Date(shift.endIso);
  if (!isFinite(start.getTime()) || !isFinite(end.getTime()) || end <= start) return;

  const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  if (end <= startMidnight) {
    const dayIndex = findDayIndexByIso_(days, shift.startIso);
    if (dayIndex >= 0) days[dayIndex].shifts.push(shift);
    return;
  }

  const firstPart = cloneShiftPart_(shift, start, startMidnight);
  const secondPart = cloneShiftPart_(shift, startMidnight, end);
  firstPart.nightPart = 'start';
  firstPart.end = '24:00';
  firstPart.hours = firstPart.start + '–24:00';
  secondPart.nightPart = 'end';

  const firstDayIndex = typeof shift.dayIndex === 'number' ? shift.dayIndex : findDayIndexByIso_(days, firstPart.startIso);
  const secondDayIndex = firstDayIndex >= 0 ? firstDayIndex + 1 : findDayIndexByIso_(days, secondPart.startIso);
  if (firstDayIndex >= 0 && firstPart.hoursValue > 0) days[firstDayIndex].shifts.push(firstPart);
  if (secondDayIndex >= 0 && secondDayIndex < days.length && secondPart.hoursValue > 0) days[secondDayIndex].shifts.push(secondPart);
}

function cloneShiftPart_(shift, start, end) {
  const hoursValue = round2_((end.getTime() - start.getTime()) / 3600000);
  const copy = {};
  Object.keys(shift).forEach(function (key) { copy[key] = shift[key]; });
  copy.hours = formatTime_(start) + '–' + formatTime_(end);
  copy.start = formatTime_(start);
  copy.end = formatTime_(end);
  copy.startIso = start.toISOString();
  copy.endIso = end.toISOString();
  copy.hoursValue = hoursValue;
  copy.duration = hoursValue;
  return copy;
}

function findDayIndexByIso_(days, iso) {
  const date = new Date(iso);
  if (!isFinite(date.getTime())) return -1;
  const key = toIsoDate_(date);
  for (let i = 0; i < days.length; i++) {
    if (days[i].isoDate === key) return i;
  }
  return -1;
}

function extractVacationGroupBlocks_(text) {
  const markers = [];
  const re = /(?:^|\n)\s*GRUPA\s+([A-Z])\s*(?:\n|\s)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    markers.push({ name: match[1].toUpperCase(), index: match.index });
  }
  markers.sort(function (a, b) { return a.index - b.index; });
  const result = {};
  markers.forEach(function (marker, index) {
    const start = marker.index;
    let end = index + 1 < markers.length ? markers[index + 1].index : text.length;
    const nightMatch = /\n\s*NOC\s*(?:\n|\s)/i.exec(text.slice(start));
    if (nightMatch) {
      const nightIndex = start + nightMatch.index;
      if (nightIndex > start && nightIndex < end) end = nightIndex;
    }
    result[marker.name] = text.slice(start, end);
  });
  return result;
}

function extractVacationNightTokens_(nightBlock) {
  const lines = normalizeText_(nightBlock).split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
  const tokens = [];
  let dayIndex = -1;
  lines.forEach(function (line) {
    if (/^NOC$/i.test(line)) return;
    if (/urlop/i.test(line)) return;
    const lineTokens = extractShiftTokens_(line);
    if (!lineTokens.length) return;
    dayIndex++;
    lineTokens.forEach(function (token) {
      tokens.push({ start: token.start, end: token.end, name: token.name, dayIndex: Math.min(dayIndex, 6) });
    });
  });
  if (tokens.length) return tokens;
  return extractShiftTokens_(nightBlock).map(function (token, index) {
    return { start: token.start, end: token.end, name: token.name, dayIndex: Math.min(index, 6) };
  });
}

function enrichTokensWithReliefInfo_(assigned) {
  const byDay = {};
  (assigned || []).forEach(function (item) {
    if (!byDay[item.dayIndex]) byDay[item.dayIndex] = [];
    byDay[item.dayIndex].push(item);
  });

  Object.keys(byDay).forEach(function (dayIndex) {
    const items = byDay[dayIndex].sort(function (a, b) {
      return tokenStartMinutes_(a) - tokenStartMinutes_(b);
    });

    items.forEach(function (item, index) {
      const previous = index > 0 ? items[index - 1] : null;
      const next = index + 1 < items.length ? items[index + 1] : null;

      item.replacesPerson = previous ? previous.name : '';
      item.replacedByPerson = next ? next.name : '';
    });
  });

  return assigned;
}

function tokenStartMinutes_(item) {
  return timeToMinutes_(item.start);
}

function timeToMinutes_(time) {
  if (!time) return 0;
  return Number(time.hour || 0) * 60 + Number(time.minute || 0);
}

function timesTouch_(leftEnd, rightStart) {
  if (!leftEnd || !rightStart) return false;
  let endMinutes = timeToMinutes_(leftEnd);
  const startMinutes = timeToMinutes_(rightStart);
  if (endMinutes === 0 && startMinutes > 18 * 60) endMinutes = 24 * 60;
  return Math.abs(endMinutes - startMinutes) <= 5;
}

function cleanReliefName_(name) {
  const cleaned = cleanupName_(name || '');
  if (!cleaned || /Łącz/i.test(cleaned) || /wolne/i.test(cleaned)) return '';
  return cleaned;
}

function firstNonEmpty_(items) {
  for (let i = 0; i < items.length; i++) {
    const value = String(items[i] || '').trim();
    if (value && value !== '–') return value;
  }
  return '';
}

function lastNonEmpty_(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    const value = String(items[i] || '').trim();
    if (value && value !== '–') return value;
  }
  return '';
}

function chooseBestPlanForEducator_(docs, weekStart, educator) {
  const sorted = (docs || []).slice().sort(compareDocs_);
  let fallbackDoc = sorted.length ? sorted[0] : null;
  for (let i = 0; i < sorted.length; i++) {
    const doc = sorted[i];
    const parsed = parseInternatSchedule_(doc.rawText || '', weekStart, educator);
    if (parsed.totalHours > 0) {
      return { doc: doc, parsed: parsed, found: true };
    }
  }
  return { doc: fallbackDoc, parsed: { days: makeEmptyDays_(weekStart), totalHours: 0 }, found: false };
}

function buildWeekView_(weekStart, educator) {
  const who = normalizeEducatorInput_(educator || CONFIG.defaultEducator);
  const docs = getScheduleDocs_(weekStart);
  const selected = chooseBestPlanForEducator_(docs, weekStart, who);
  const days = selected.parsed.days || makeEmptyDays_(weekStart);
  const previousDoc = selected.doc ? findPreviousDocumentForWeek_(docs, selected.doc) : null;
  const changes = selected.doc && previousDoc ? buildEducatorChanges_(previousDoc, selected.doc, weekStart, who) : [];
  applyChangesToDays_(days, changes);
  const totalHours = round2_(days.reduce(function (sum, day) { return sum + Number(day.hoursDay || 0); }, 0));
  const weekendHours = round2_(days.filter(function (day) { return day.weekend; }).reduce(function (sum, day) { return sum + Number(day.hoursDay || 0); }, 0));
  const source = selected.doc ? selected.doc.source : null;

  return {
    weekNumber: selected.doc ? selected.doc.weekNumber : null,
    label: selected.doc && selected.doc.weekNumber ? 'Tydzień ' + selected.doc.weekNumber : 'Tydzień',
    range: formatRange_(weekStart),
    dateFrom: weekStart,
    dateTo: toIsoDate_(addDays_(parseIsoDate_(weekStart), 6)),
    weekStart: weekStart,
    weekEnd: toIsoDate_(addDays_(parseIsoDate_(weekStart), 6)),
    educator: who,
    hasData: docs.length > 0,
    hasEducatorPlan: selected.found,
    source: source ? source.filename : '',
    sourceInfo: source,
    availableDocuments: docs.map(function (doc) { return { filename: doc.source.filename, kind: doc.source.kind, priority: doc.source.priority, messageDate: doc.source.messageDate }; }),
    changes: changes,
    hasChanges: changes.length > 0,
    updatedAt: selected.doc ? selected.doc.updatedAt : null,
    totalHours: totalHours,
    overtimeHours: Math.max(0, round2_(totalHours - CONFIG.baseWeeklyHours)),
    weekendHours: weekendHours,
    weekendWorkDays: days.filter(function (day) { return day.weekend && Number(day.hoursDay || 0) > 0; }).length,
    summary: {
      totalHours: totalHours,
      overtimeHours: Math.max(0, round2_(totalHours - CONFIG.baseWeeklyHours)),
      weekendHours: weekendHours,
      weekendWorkDays: days.filter(function (day) { return day.weekend && Number(day.hoursDay || 0) > 0; }).length
    },
    days: days
  };
}

function buildHistory_(educator) {
  const who = normalizeEducatorInput_(educator || CONFIG.defaultEducator);
  return getStoredWeekStarts_()
    .slice(-CONFIG.historyWeeks)
    .map(function (weekStart) {
      const view = buildWeekView_(weekStart, who);
      return { weekNumber: view.weekNumber, weekStart: view.weekStart, weekEnd: view.weekEnd, range: view.range, totalHours: view.totalHours, overtimeHours: view.overtimeHours, weekendHours: view.weekendHours, weekendWorkDays: view.weekendWorkDays, sourceFilename: view.source, sourceKind: view.sourceInfo ? view.sourceInfo.kind : '', sourcePriority: view.sourceInfo ? view.sourceInfo.priority : '', updatedAt: view.updatedAt };
    });
}


function findPreviousDocumentForWeek_(docs, currentDoc) {
  if (!currentDoc || !currentDoc.source) return null;
  const sorted = (docs || []).slice().sort(compareDocs_);
  for (let i = 0; i < sorted.length; i++) {
    const doc = sorted[i];
    if (!doc || !doc.source) continue;
    if (doc.source.digest === currentDoc.source.digest) {
      return sorted[i + 1] || null;
    }
  }
  return sorted.length > 1 ? sorted[1] : null;
}

function buildEducatorChanges_(previousDoc, currentDoc, weekStart, educator) {
  if (!previousDoc || !currentDoc) return [];
  const previous = parseInternatSchedule_(previousDoc.rawText || '', weekStart, educator);
  const current = parseInternatSchedule_(currentDoc.rawText || '', weekStart, educator);
  const changes = [];

  for (let i = 0; i < 7; i++) {
    const beforeDay = previous.days[i] || {};
    const afterDay = current.days[i] || {};
    const before = summarizeDayShifts_(beforeDay);
    const after = summarizeDayShifts_(afterDay);
    if (before === after) continue;

    const date = afterDay.isoDate || beforeDay.isoDate || toIsoDate_(addDays_(parseIsoDate_(weekStart), i));
    const dayName = afterDay.label || beforeDay.label || (CONFIG.days[i] ? CONFIG.days[i].label : 'Dzień');
    changes.push({
      id: sha256_([weekStart, educator, date, before, after, currentDoc.source.digest].join('|')),
      weekStart: weekStart,
      date: date,
      dayIndex: i,
      dayName: dayName,
      before: before || 'wolne / brak wpisu',
      after: after || 'wolne / brak wpisu',
      message: 'Zmieniono dyżur dla ' + educator + ': ' + (before || 'wolne') + ' → ' + (after || 'wolne'),
      sourceFilename: currentDoc.source.filename,
      previousFilename: previousDoc.source.filename
    });
  }
  return changes;
}

function applyChangesToDays_(days, changes) {
  const byIndex = {};
  (changes || []).forEach(function (change) {
    if (!byIndex[change.dayIndex]) byIndex[change.dayIndex] = [];
    byIndex[change.dayIndex].push(change);
  });
  (days || []).forEach(function (day, index) {
    day.changes = byIndex[index] || [];
    day.hasChange = day.changes.length > 0;
  });
}

function summarizeDayShifts_(day) {
  return (day.shifts || []).map(function (shift) {
    return [shift.label || 'Dyżur', shift.hours || '', shift.replacesPerson ? ('zmieniam ' + shift.replacesPerson) : '', shift.replacedByPerson ? ('zmienia mnie ' + shift.replacedByPerson) : '']
      .filter(Boolean)
      .join(' / ');
  }).join('; ');
}

function getAvailableEducators_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const names = {};
  Object.keys(props).forEach(function (key) {
    if (key.indexOf('docs:') !== 0) return;
    let docs = [];
    try { docs = JSON.parse(props[key]) || []; } catch (err) { docs = []; }
    docs.forEach(function (doc) {
      collectEducatorsFromText_(doc.rawText || '').forEach(function (name) { names[name] = true; });
    });
  });
  return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'pl'); }).slice(0, 80);
}

function collectEducatorsFromText_(text) {
  const normalized = normalizeText_(text || '');
  const output = {};
  const groupBlocks = extractGroupBlocks_(normalized);
  Object.keys(groupBlocks).forEach(function (groupName) {
    extractShiftTokens_(groupBlocks[groupName]).forEach(function (token) {
      const name = simplifyEducatorName_(token.name);
      if (name) output[name] = true;
    });
  });
  const nightBlock = extractNightBlock_(normalized);
  if (nightBlock) {
    extractShiftTokens_(nightBlock).forEach(function (token) {
      const name = simplifyEducatorName_(token.name);
      if (name) output[name] = true;
    });
  }
  return Object.keys(output);
}

function simplifyEducatorName_(name) {
  const cleaned = cleanupName_(name || '')
    .replace(/\bZast\.?\b/ig, '')
    .replace(/\d+.*/g, '')
    .replace(/[,;:].*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^(INTERNAT|NOC|Gr|Grupa|Łącz|wolne)$/i.test(cleaned)) return '';
  const parts = cleaned.split(' ').filter(Boolean);
  return parts[parts.length - 1] || cleaned;
}

function syncWeekToCalendar_(weekStart) {
  const view = buildWeekView_(weekStart, CONFIG.calendarEducator);
  if (!view.hasData) {
    Logger.log('Brak dokumentów tygodnia do synchronizacji kalendarza: ' + weekStart);
    return;
  }

  const timeMin = parseIsoDate_(weekStart).toISOString();
  const timeMax = addDays_(parseIsoDate_(weekStart), 8).toISOString();
  const markerWeek = 'HARMONOGRAM_WEEK=' + weekStart;
  const markerEducator = 'HARMONOGRAM_EDUCATOR=' + CONFIG.calendarEducator;
  const existing = Calendar.Events.list(CONFIG.calendarId, { timeMin: timeMin, timeMax: timeMax, singleEvents: true, q: 'HARMONOGRAM_APP=1' });
  let removed = 0;
  (existing.items || []).forEach(function (event) {
    const description = event.description || '';
    if (description.indexOf(markerWeek) !== -1 && description.indexOf(markerEducator) !== -1) {
      Calendar.Events.remove(CONFIG.calendarId, event.id);
      removed++;
    }
  });

  let inserted = 0;
  view.days.forEach(function (day) {
    day.shifts.forEach(function (shift) {
      const event = {
        summary: 'Praca MOW — ' + CONFIG.calendarEducator,
        location: 'MOW',
        description: ['Automatycznie dodane z aplikacji Harmonogram MOW.', 'Źródło: ' + (view.source || ''), 'Typ: ' + shift.label, 'HARMONOGRAM_APP=1', 'HARMONOGRAM_EDUCATOR=' + CONFIG.calendarEducator, 'HARMONOGRAM_WEEK=' + weekStart].join('\n'),
        start: { dateTime: shift.startIso, timeZone: Session.getScriptTimeZone() },
        end: { dateTime: shift.endIso, timeZone: Session.getScriptTimeZone() }
      };
      Calendar.Events.insert(event, CONFIG.calendarId);
      inserted++;
    });
  });
  Logger.log('Kalendarz tydzień ' + weekStart + ': wychowawca=' + CONFIG.calendarEducator + ', usunięto=' + removed + ', dodano=' + inserted);
}

function extractGroupBlocks_(text) {
  const names = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const markers = [];
  names.forEach(function (name) {
    const re = new RegExp('(?:^|\\n)\\s*' + name + '\\s*(?:\\n|\\s)', 'g');
    let match;
    while ((match = re.exec(text)) !== null) {
      markers.push({ name: name, index: match.index });
      break;
    }
  });
  markers.sort(function (a, b) { return a.index - b.index; });
  const result = {};
  markers.forEach(function (marker, index) {
    const start = marker.index;
    let end = index + 1 < markers.length ? markers[index + 1].index : text.length;
    const nightMatch = /\n\s*NOC\s*(?:\n|\s)/i.exec(text.slice(start));
    if (nightMatch) {
      const nightIndex = start + nightMatch.index;
      if (nightIndex > start && nightIndex < end) end = nightIndex;
    }
    result[marker.name] = text.slice(start, end);
  });
  return result;
}

function extractNightBlock_(text) {
  const match = /\n\s*NOC\s*(?:\n|\s)/i.exec(text);
  return match ? text.slice(match.index) : '';
}

function extractShiftTokens_(block) {
  const clean = normalizeText_(block)
    .replace(/(\d)\s+(\d{2})(?=\s*-)/g, '$1$2')
    .replace(/-\s*(\d)\s+(\d{2})/g, '-$1$2')
    .replace(/(\d{1,2})\s+(\d{2})\s+([A-ZĄĆĘŁŃÓŚŹŻ])/g, '$1$2 $3');
  const re = /(\d{1,2}\s*[:.]?\s*\d{0,2})\s*-\s*(\d{1,2}\s*[:.]?\s*\d{0,2})\s+((?:Zast\.\s*)?[A-ZĄĆĘŁŃÓŚŹŻ][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.\- ]{1,45})/g;
  const tokens = [];
  let match;
  while ((match = re.exec(clean)) !== null) {
    const start = parseTimeToken_(match[1]);
    const end = parseTimeToken_(match[2]);
    const name = cleanupName_(match[3]);
    if (!start || !end || !name) continue;
    if (/Łącz/i.test(name)) continue;
    if (/wolne/i.test(name)) continue;
    tokens.push({ start: start, end: end, name: name, index: match.index });
  }
  return tokens;
}

function assignTokensToDays_(tokens) {
  const result = [];
  let dayIndex = 0;
  let previousStartMinutes = null;
  tokens.forEach(function (token, index) {
    const currentStartMinutes = token.start.hour * 60 + token.start.minute;
    if (index > 0 && currentStartMinutes <= 8 * 60 && previousStartMinutes !== null && previousStartMinutes > 8 * 60 && dayIndex < 6) dayIndex++;
    result.push({ dayIndex: dayIndex, start: token.start, end: token.end, name: token.name });
    previousStartMinutes = currentStartMinutes;
  });
  return result;
}

function buildShift_(weekStartIso, dayIndex, start, end, type, label) {
  const date = addDays_(parseIsoDate_(weekStartIso), dayIndex);
  const startDate = makeDateTime_(date, start.hour, start.minute);
  let endDate = makeDateTime_(date, end.hour, end.minute);
  if (endDate <= startDate) endDate = addDays_(endDate, 1);
  const hoursValue = round2_((endDate.getTime() - startDate.getTime()) / 3600000);
  return { type: type, label: label, dayIndex: dayIndex, hours: formatTime_(startDate) + '–' + formatTime_(endDate), start: formatTime_(startDate), end: formatTime_(endDate), startIso: startDate.toISOString(), endIso: endDate.toISOString(), hoursValue: hoursValue, duration: hoursValue };
}

function detectWeek_(filename, subject, text, messageDate) {
  return detectWeekFromSources_([String(filename || ''), String(subject || ''), String(text || '')], messageDate || new Date());
}

function detectWeekNumber_(filename, text) {
  const source = String(filename || '') + '\n' + String(text || '');
  const match = source.match(/(?:^|\s)(\d{1,2})\s*\./);
  return match ? Number(match[1]) : null;
}

function detectExplicitWeek_(filename, subject) {
  return detectWeekFromSources_([String(filename || ''), String(subject || '')], null);
}

function detectWeekFromSources_(sources, fallbackDate) {
  for (let i = 0; i < sources.length; i++) {
    const source = String(sources[i] || '')
      .replace(/\r/g, '\n')
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/(^|\s)\d{1,3}\.\s+(?=\d{1,2}(?:\s*[.\/]\s*\d{1,2})?\s*-)/g, '$1');
    const rangeRegex = /(?:^|[^\d])(\d{1,2})(?:\s*[.\/]\s*(\d{1,2}))?\s*-\s*(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[\/.]?\s*(20\d{2})/g;
    let match;
    while ((match = rangeRegex.exec(source)) !== null) {
      const startDay = Number(match[1]);
      const startMonthRaw = match[2] ? Number(match[2]) : null;
      const endDay = Number(match[3]);
      const endMonth = Number(match[4]);
      const year = Number(match[5]);
      if (!isValidDayMonth_(startDay, endMonth)) continue;
      if (!isValidDayMonth_(endDay, endMonth)) continue;
      let startMonth = startMonthRaw || endMonth;
      let startYear = year;
      if (!startMonthRaw && startDay > endDay) {
        startMonth = endMonth - 1;
        if (startMonth < 1) { startMonth = 12; startYear = year - 1; }
      }
      const startDate = new Date(startYear, startMonth - 1, startDay);
      const endDate = new Date(year, endMonth - 1, endDay);
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
      if (diffDays >= 4 && diffDays <= 9) {
        const monday = mondayOf_(startDate);
        return { weekStart: toIsoDate_(monday), weekEnd: toIsoDate_(addDays_(monday, 6)), dateFrom: toIsoDate_(monday), dateTo: toIsoDate_(addDays_(monday, 6)) };
      }
    }
  }
  if (!fallbackDate) return null;
  const fallbackMonday = mondayOf_(fallbackDate || new Date());
  return { weekStart: toIsoDate_(fallbackMonday), weekEnd: toIsoDate_(addDays_(fallbackMonday, 6)), dateFrom: toIsoDate_(fallbackMonday), dateTo: toIsoDate_(addDays_(fallbackMonday, 6)) };
}

function isWeekInScanWindow_(weekStartIso) {
  const weekStart = parseIsoDate_(weekStartIso);
  const weekEnd = addDays_(weekStart, 6);
  const today = startOfDay_(new Date());
  const minDate = addDays_(today, -CONFIG.scanPastDays);
  const maxDate = addDays_(today, CONFIG.scanFutureDays);
  return weekEnd >= minDate && weekStart <= maxDate;
}

function makeEmptyDays_(weekStartIso) {
  return CONFIG.days.map(function (day) {
    const date = addDays_(parseIsoDate_(weekStartIso), day.offset);
    return { name: day.short, label: day.label, date: Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd.MM'), isoDate: toIsoDate_(date), weekend: day.weekend, shifts: [], zmieniam: '', zmienia: '', hoursDay: 0 };
  });
}

function parseTimeToken_(value) {
  const raw = String(value || '').replace(/\s+/g, '').replace('.', ':');
  let hour;
  let minute;
  if (/^24:?00?$/.test(raw) || raw === '2400') return { hour: 0, minute: 0 };
  if (raw.indexOf(':') !== -1) {
    const parts = raw.split(':');
    hour = Number(parts[0]);
    minute = Number(parts[1] || 0);
  } else if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, '0');
    hour = Number(padded.slice(0, 2));
    minute = Number(padded.slice(2));
  } else if (/^\d{1,2}$/.test(raw)) {
    hour = Number(raw);
    minute = 0;
  } else {
    return null;
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour: hour, minute: minute };
}

function isSelectedEducator_(name, educator) {
  const normalizedName = normalizeName_(name);
  const aliases = getEducatorAliases_(educator);
  return aliases.some(function (alias) {
    const normalizedAlias = normalizeName_(alias);
    return normalizedAlias && normalizedName.indexOf(normalizedAlias) !== -1;
  });
}

function getEducatorAliases_(educator) {
  const who = normalizeEducatorInput_(educator);
  const configured = CONFIG.aliases[who] || [];
  const parts = who.split(/\s+/).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : who;
  return unique_([who, last].concat(configured));
}

function normalizeEducatorInput_(value) {
  return String(value || CONFIG.defaultEducator).replace(/\s+/g, ' ').trim() || CONFIG.defaultEducator;
}

function cleanupName_(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/\bZast\.\s*/i, '')
    .replace(/\bzwolnienie\b.*$/i, '')
    .replace(/\blekarskie\b.*$/i, '')
    .replace(/\bGrupa\b.*$/i, '')
    .trim();
}

function detectReplacingPerson_(shifts) { return shifts.length ? '–' : ''; }

function dedupeShifts_(shifts) {
  const seen = {};
  const result = [];
  shifts.forEach(function (shift) {
    const key = [shift.type, shift.label, shift.startIso, shift.endIso].join('|');
    if (seen[key]) return;
    seen[key] = true;
    result.push(shift);
  });
  return result;
}

function normalizeText_(text) {
  return String(text || '').replace(/\r/g, '\n').replace(/[–—]/g, '-').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\s+\n/g, '\n');
}

function normalizeName_(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function htmlDecode_(value) {
  return String(value || '').replace(/&#40;/g, '(').replace(/&#41;/g, ')').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function isValidDayMonth_(day, month) {
  return Number.isInteger(day) && Number.isInteger(month) && day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

function deleteExistingTriggers_(handlerName) {
  ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === handlerName; }).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
}

function clearProcessedMarkers_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (key) { if (key.indexOf('processed:') === 0) props.deleteProperty(key); });
}

function clearAllStoredWeeks() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (key) {
    if (key.indexOf('week:') === 0 || key.indexOf('docs:') === 0 || key.indexOf('processed:') === 0 || key === 'alerts') props.deleteProperty(key);
  });
  Logger.log('Usunięto zapisane dokumenty tygodni, stare tygodnie, alerty i znaczniki processed.');
}

function jsonOutput_(payload, callback, transport) {
  payload = repairMojibake_(payload);
  const json = JSON.stringify(payload);
  const mode = String(transport || '').toLowerCase();
  const cb = String(callback || '').trim();

  if (mode === 'bridge' || mode === 'iframe' || mode === 'html') {
    return bridgeOutput_(payload);
  }

  if (cb && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(cb)) {
    return ContentService
      .createTextOutput(cb + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function repairMojibake_(value) {
  if (typeof value === 'string') return repairMojibakeText_(value);
  if (Array.isArray(value)) return value.map(function (item) { return repairMojibake_(item); });
  if (value && Object.prototype.toString.call(value) === '[object Date]') return value;
  if (value && typeof value === 'object') {
    const copy = {};
    Object.keys(value).forEach(function (key) { copy[key] = repairMojibake_(value[key]); });
    return copy;
  }
  return value;
}

function repairMojibakeText_(value) {
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
    .replace(/\u00C5\u0192/g, '\u0143')
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

function bridgeOutput_(payload) {
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  const html = '<!doctype html>' +
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Harmonogram MOW Backend</title>' +
    '<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:20px;line-height:1.4}pre{white-space:pre-wrap;background:#f3f4f6;padding:14px;border-radius:12px;overflow:auto}</style>' +
    '</head><body>' +
    '<h1>Harmonogram MOW Backend</h1>' +
    '<p>Jeżeli widzisz ten ekran, wdrożenie Apps Script odpowiada. Aplikacja odbiera te dane przez bezpieczny most iframe/postMessage, bez CORS i bez JSONP.</p>' +
    '<pre id="out"></pre>' +
    '<script>' +
    '(function(){' +
    'var payload=' + json + ';' +
    'document.getElementById("out").textContent=JSON.stringify(payload,null,2);' +
    'try{parent.postMessage({source:"harmonogram-mow-backend",payload:payload},"*");}catch(e){}' +
    '})();' +
    '</script>' +
    '</body></html>';

  return HtmlService
    .createHtmlOutput(html)
    .setTitle('Harmonogram MOW Backend')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function sha256_(value) {
  const bytes = Array.isArray(value) ? value : Utilities.newBlob(String(value)).getBytes();
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (byte) { return (byte + 256).toString(16).slice(-2); }).join('');
}

function mondayOf_(date) {
  const d = startOfDay_(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

function startOfDay_(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays_(date, days) { const d = new Date(date.getTime()); d.setDate(d.getDate() + days); return d; }
function parseIsoDate_(iso) { const parts = String(iso).split('-').map(Number); return new Date(parts[0], parts[1] - 1, parts[2]); }
function toIsoDate_(date) { return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function makeDateTime_(date, hour, minute) { return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0); }
function formatTime_(date) { return Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH:mm'); }
function formatRange_(weekStartIso) { const start = parseIsoDate_(weekStartIso); const end = addDays_(start, 6); return Utilities.formatDate(start, Session.getScriptTimeZone(), 'dd.MM') + ' – ' + Utilities.formatDate(end, Session.getScriptTimeZone(), 'dd.MM.yyyy'); }
function round2_(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function unique_(items) { const seen = {}; return items.filter(function (item) { const key = normalizeName_(item); if (!key || seen[key]) return false; seen[key] = true; return true; }); }
