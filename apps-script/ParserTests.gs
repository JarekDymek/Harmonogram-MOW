function runParserTests() {
  const week = detectWeek_('41. 08 - 14.06.2026r..docx', 'Grafik internatu', '', new Date(2026, 5, 3));
  assertEqual_(week.dateFrom, '2026-06-08', 'dateFrom');
  assertEqual_(week.dateTo, '2026-06-14', 'dateTo');
  assertEqual_(week.weekStart, '2026-06-08', 'weekStart');
  assertEqual_(week.weekEnd, '2026-06-14', 'weekEnd');

  const yearBoundaryWeek = detectWeek_('Grafik 30.12-05.01.2027.docx', 'Grafik internatu', '', new Date(2026, 11, 20));
  assertEqual_(yearBoundaryWeek.weekStart, '2026-12-28', 'year boundary weekStart');
  assertEqual_(yearBoundaryWeek.weekEnd, '2027-01-03', 'year boundary weekEnd');

  const t1 = parseTimeToken_('700');
  assertEqual_(t1.hour, 7, '700 hour');
  assertEqual_(t1.minute, 0, '700 minute');
  const t2 = parseTimeToken_('13.30');
  assertEqual_(t2.hour, 13, '13.30 hour');
  assertEqual_(t2.minute, 30, '13.30 minute');
  const t3 = parseTimeToken_('22:00');
  assertEqual_(t3.hour, 22, '22:00 hour');
  assertEqual_(t3.minute, 0, '22:00 minute');

  const sample = [
    'INTERNAT', '08 - 14.06.2026r.', '41.', 'VI', 'IIIbr',
    '600- 800 Osoba Pierwsza', '1430- 2200 Osoba Testowa',
    '600-800 Osoba Druga', '1330- 1530 Osoba Trzecia', '1530 - 1930 Osoba Druga', '1930- 2200 Osoba Pierwsza',
    '600- 800 Osoba Testowa', '1300- 1900 Osoba Pierwsza', '1900-2200 Osoba Druga',
    '600- 800 Osoba Testowa', '1300-1400 Osoba Czwarta', '1400- 2200 Osoba Testowa',
    '600- 1400 Osoba Druga', '1400- 2200 Osoba Pierwsza',
    '600- 800 Łącz z V', '800- 1600 Osoba Druga', '1600- 2200 Osoba Testowa',
    '600-800 Łącz z V', '800- 1400 Osoba Druga', '1400- 2200 Osoba Pierwsza',
    '1.Osoba Pierwsza – 32,5', '2.Osoba Druga – 31', '3.Osoba Testowa –33,5',
    'VII', '6 A', '600-800 Osoba Piąta', '1230 - 2200 Osoba Piąta',
    'NOC', '2400-600 Osoba Pierwsza', '2200-600 Nocny Pierwszy', '2200-600 Osoba Testowa', '2200-600 Nocny Drugi', '2200-600 Nocny Trzeci', '2200-600 Nocny Czwarty', '2200-600 Nocny Piąty'
  ].join('\n');

  const parsedTestPerson = parseInternatSchedule_(sample, '2026-06-08', 'Osoba Testowa');
  assertEqual_(parsedTestPerson.days[0].hoursDay, 7.5, 'osoba testowa PON hours');
  assertEqual_(parsedTestPerson.days[2].hoursDay, 4, 'osoba testowa ŚR hours z początkiem nocy');
  assertEqual_(parsedTestPerson.days[3].hoursDay, 16, 'osoba testowa CZW hours z końcem nocy');
  assertEqual_(parsedTestPerson.days[5].hoursDay, 6, 'osoba testowa SOB hours');
  assertEqual_(parsedTestPerson.days[0].shifts[0].replacesPerson, 'Osoba Pierwsza', 'osoba testowa PON zmieniam');
  assertEqual_(parsedTestPerson.days[2].shifts[0].replacedByPerson, 'Osoba Pierwsza', 'osoba testowa ŚR zmienia mnie');
  const thursdayLateShift = parsedTestPerson.days[3].shifts.filter(function (shift) { return shift.start === '14:00'; })[0];
  assertEqual_(thursdayLateShift.replacesPerson, 'Osoba Czwarta', 'osoba testowa CZW zmiana 14:00 zmieniam');
  assertEqual_(parsedTestPerson.days[5].shifts[0].replacesPerson, 'Osoba Druga', 'osoba testowa SOB zmieniam');

  const parsedSecondPerson = parseInternatSchedule_(sample, '2026-06-08', 'Osoba Druga');
  const nightDays = makeEmptyDays_('2026-06-29');
  addShiftToDays_(nightDays, buildShift_('2026-06-29', 2, parseTimeToken_('22:00'), parseTimeToken_('06:00'), 'noc', 'Noc'));
  const calendarParts = getCalendarShiftsForWeek_({ days: nightDays });
  assertEqual_(calendarParts.length, 2, 'night calendar parts');
  assertEqual_(calendarParts[0].start, '22:00', 'night first start');
  assertEqual_(calendarParts[0].end, '24:00', 'night first end');
  assertEqual_(calendarParts[1].start, '00:00', 'night second start');
  assertEqual_(calendarParts[1].end, '06:00', 'night second end');
  assertEqual_(parsedSecondPerson.days[1].hoursDay, 6, 'osoba druga WT hours');
  assertEqual_(parsedSecondPerson.days[2].hoursDay, 3, 'osoba druga ŚR hours');
  assertEqual_(parsedSecondPerson.days[4].hoursDay, 8, 'osoba druga PT hours');
  assertEqual_(parsedSecondPerson.days[5].hoursDay, 8, 'osoba druga SOB hours');

  const fullInternatWeek = buildInternatWeekFromDocs_('2026-06-08', [{
    weekNumber: 41,
    rawText: sample,
    educators: ['Pierwsza', 'Druga', 'Testowa'],
    source: { filename: 'grafik-testowy.docx', priority: 90, messageDate: '2026-06-01T10:00:00.000Z' }
  }]);
  assertEqual_(fullInternatWeek.staffCount, 3, 'full internat staff count');
  assertEqual_(fullInternatWeek.days[0].shifts.length, 3, 'full internat Monday shifts');

  Logger.log('Parser tests OK');
}

function assertEqual_(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ': expected ' + expected + ', got ' + actual);
}
