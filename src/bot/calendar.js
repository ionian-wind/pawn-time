/** @typedef {{ year: number, monthIndex: number }} CalendarMonth */

/**
 * Returns a "month" struct for the current local month.
 * @returns {CalendarMonth}
 */
export function currentCalendar() {
  return calendarFromDate(new Date());
}

/**
 * Returns the month one step before/after `calendar`.
 * @param {CalendarMonth} calendar
 * @param {1 | -1} dir
 * @returns {CalendarMonth}
 */
export function shiftMonth(calendar, dir) {
  const total = calendar.year * 12 + calendar.monthIndex + dir;
  const year = Math.floor(total / 12);
  const monthIndex = ((total % 12) + 12) % 12;
  return { year, monthIndex };
}

/**
 * Builds the cells and labels needed to render one calendar month.
 * Weeks start on Monday; `<weeks>` is a rows-of-7 grid of cells whose
 * `isoDate` is non-null only for in-month days.
 * @param {CalendarMonth} calendar
 * @param {string} [locale]
 * @returns {{
 *   title: string,
 *   weekdays: Array<string>,
 *   weeks: Array<Array<{ isoDate: string | null, day: number | null }>>
 * }}
 */
export function calendarGrid(calendar, locale = 'en') {
  const { year, monthIndex } = calendar;
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // 0 = Monday

  const dayList = [
    ...Array.from({ length: lead }, () => ({ isoDate: null, day: null })),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const isoDate = toIso(calendar, day);
      return { isoDate, day };
    }),
  ];
  while (dayList.length % 7 !== 0) dayList.push({ isoDate: null, day: null });

  const weeks = [];
  for (let i = 0; i < dayList.length; i += 7) weeks.push(dayList.slice(i, i + 7));

  return {
    title: first.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
    weekdays: weekdayHeaders(locale),
    weeks,
  };
}

/**
 * Localized 7-element weekday-header labels in Monday-first order.
 * @param {string} locale
 * @returns {Array<string>}
 */
function weekdayHeaders(locale) {
  // 2024-01-01 was a Monday.
  const base = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + i).toLocaleDateString(locale, {
      weekday: 'short',
    })
  );
}

/** @param {CalendarMonth} calendar @param {number} day @returns {string} */
function toIso(calendar, day) {
  return `${calendar.year}-${String(calendar.monthIndex + 1).padStart(2, '0')}-${String(
    day
  ).padStart(2, '0')}`;
}

/** @param {Date} [date] @returns {CalendarMonth} */
function calendarFromDate(date = new Date()) {
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}
