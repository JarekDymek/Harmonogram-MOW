function runParserTests() {
  const week = detectWeek_('41. 08 - 14.06.2026r..docx', 'Grafik internatu', '', new Date(2026, 5, 3));
  assertEqual_(week.dateFrom, '2026-06-08', 'dateFrom');
  assertEqual_(week.dateTo, '2026-06-14', 'dateTo');
  assertEqual_(week.weekStart, '2026-06-08', 'weekStart');
  assertEqual_(week.weekEnd, '2026-06-14', 'weekEnd');

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
    '600- 800 Dembiński', '1430- 2200 Dymek',
    '600-800 Kowalska', '1330- 1530 Górski', '1530 - 1930 Kowalska', '1930- 2200 Dembiński',
    '600- 800 Dymek', '1300- 1900 Dembiński', '1900-2200 Kowalska',
    '600- 800 Dymek', '1300-1400 Chlebowski', '1400- 2200 Dymek',
    '600- 1400 Kowalska', '1400- 2200 Dembiński',
    '600- 800 Łącz z V', '800- 1600 Kowalska', '1600- 2200 Dymek',
    '600-800 Łącz z V', '800- 1400 Kowalska', '1400- 2200 Dembiński',
    '1.Dembiński – 32,5', '2.Kowalska – 31', '3.Dymek –33,5',
    'VII', '6 A', '600-800 Polkowski', '1230 - 2200 Polkowski',
    'NOC', '2400-600 Dembiński', '2200-600 Stankiewicz', '2200-600 Dymek', '2200-600 Piłat', '2200-600 Ochałek', '2200-600 Worożański', '2200-600 Świderski'
  ].join('\n');

  const parsedDymek = parseInternatSchedule_(sample, '2026-06-08', 'Dymek');
  assertEqual_(parsedDymek.days[0].hoursDay, 7.5, 'Dymek PON hours');
  assertEqual_(parsedDymek.days[2].hoursDay, 10, 'Dymek ŚR hours');
  assertEqual_(parsedDymek.days[3].hoursDay, 10, 'Dymek CZW hours');
  assertEqual_(parsedDymek.days[5].hoursDay, 6, 'Dymek SOB hours');
  assertEqual_(parsedDymek.days[0].shifts[0].replacesPerson, 'Dembiński', 'Dymek PON zmieniam');
  assertEqual_(parsedDymek.days[2].shifts[0].replacedByPerson, 'Dembiński', 'Dymek ŚR zmienia mnie');
  assertEqual_(parsedDymek.days[3].shifts[1].replacesPerson, 'Chlebowski', 'Dymek CZW druga zmiana zmieniam');
  assertEqual_(parsedDymek.days[5].shifts[0].replacesPerson, 'Kowalska', 'Dymek SOB zmieniam');

  const parsedKowalska = parseInternatSchedule_(sample, '2026-06-08', 'Kowalska');
  const nightDays = makeEmptyDays_('2026-06-29');
  addShiftToDays_(nightDays, buildShift_('2026-06-29', 2, parseTimeToken_('22:00'), parseTimeToken_('06:00'), 'noc', 'Noc'));
  const calendarParts = getCalendarShiftsForWeek_({ days: nightDays });
  assertEqual_(calendarParts.length, 2, 'night calendar parts');
  assertEqual_(calendarParts[0].start, '22:00', 'night first start');
  assertEqual_(calendarParts[0].end, '24:00', 'night first end');
  assertEqual_(calendarParts[1].start, '00:00', 'night second start');
  assertEqual_(calendarParts[1].end, '06:00', 'night second end');
  assertEqual_(parsedKowalska.days[1].hoursDay, 6, 'Kowalska WT hours');
  assertEqual_(parsedKowalska.days[2].hoursDay, 3, 'Kowalska ŚR hours');
  assertEqual_(parsedKowalska.days[4].hoursDay, 8, 'Kowalska PT hours');
  assertEqual_(parsedKowalska.days[5].hoursDay, 8, 'Kowalska SOB hours');

  Logger.log('Parser tests OK — v11');
}

function assertEqual_(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ': expected ' + expected + ', got ' + actual);
}
