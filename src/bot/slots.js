const MS_PER_DAY = 86_400_000;

/**
 * Returns an ISO date string (YYYY-MM-DD) for a Date in local time.
 * @param {Date} date
 * @returns {string}
 */
export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Builds a horizon of candidate dates (ISO strings) starting today.
 * @param {Date} [from]
 * @param {number} [count]
 * @returns {Array<string>}
 */
export function generateDayOptions(from = new Date(), count = 14) {
  const options = [];
  for (let i = 0; i < count; i += 1) {
    options.push(toIsoDate(new Date(from.getTime() + i * MS_PER_DAY)));
  }
  return options;
}

/**
 * Generates 30-minute time slots between the given window.
 * @param {number} [startHour]
 * @param {number} [endHour] - exclusive upper bound, as hours of day
 * @param {number} [stepMinutes]
 * @returns {Array<{ start: string, end: string }>}
 */
export function generateTimeSlots(startHour = 9, endHour = 22, stepMinutes = 30) {
  /** @type {Array<{ start: string, end: string }>} */
  const slots = [];
  for (
    let minutes = startHour * 60;
    minutes + stepMinutes <= endHour * 60;
    minutes += stepMinutes
  ) {
    const start = toHhmm(minutes);
    const end = toHhmm(minutes + stepMinutes);
    slots.push({ start, end });
  }
  return slots;
}

/**
 * Formats a Date as a short weekday + date label, e.g. "Mon, Sep 1" (en) or
 * "пн., 1 сент." (ru).
 * @param {string} isoDate
 * @param {string} [locale]
 * @returns {string}
 */
export function formatDisplayDate(isoDate, locale = 'en') {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Formats a timeslot as "HH:MM–HH:MM".
 * @param {import('../domains/draft/draft.entity.js').DraftTimeSlot} slot
 * @returns {string}
 */
export function formatSlot(slot) {
  return `${slot.start}–${slot.end}`;
}

/**
 * Converts minutes past midnight to an HH:MM 24h string.
 * @param {number} minutes
 * @returns {string}
 */
function toHhmm(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}
