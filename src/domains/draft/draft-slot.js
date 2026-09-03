/**
 * Helpers for manipulating draft time selections as continuous intervals.
 *
 * A draft stores selected 30-minute availability as merged intervals
 * ({ start, end }), so consecutive picks (09:00, 09:30, 10:00) coalesce into a
 * single range "09:00–10:00" instead of three distinct values.
 */

/**
 * Converts an "HH:MM" time to minutes past midnight.
 * @param {string} hhmm
 * @returns {number}
 */
export function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Converts minutes past midnight to an "HH:MM" 24h string.
 * @param {number} minutes
 * @returns {string}
 */
export function minutesToHhmm(minutes) {
  const h = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Merges adjacent/contiguous slots into continuous intervals. Input slots are
 * treated as half-open ranges [start, end); two slots merge when one's start
 * equals the previous one's end. Returns a new sorted array and does not modify
 * the input.
 * @param {Array<{ start: string, end: string }>} slots
 * @returns {Array<{ start: string, end: string }>}
 */
export function mergeSlots(slots) {
  const sorted = slots.slice().sort((a, b) => hhmmToMinutes(a.start) - hhmmToMinutes(b.start));
  /** @type {Array<{ start: string, end: string }>} */
  const merged = [];
  for (const slot of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && hhmmToMinutes(prev.end) === hhmmToMinutes(slot.start)) {
      if (hhmmToMinutes(slot.end) > hhmmToMinutes(prev.end)) {
        prev.end = slot.end;
      }
    } else {
      merged.push({ start: slot.start, end: slot.end });
    }
  }
  return merged;
}

/**
 * Expands merged intervals back into discrete slots of `stepMinutes` (default
 * 30). E.g. "09:00–10:00" becomes "09:00–09:30" and "09:30–10:00".
 * @param {Array<{ start: string, end: string }>} slots
 * @param {number} [stepMinutes]
 * @returns {Array<{ start: string, end: string }>}
 */
export function expandSlots(slots, stepMinutes = 30) {
  /** @type {Array<{ start: string, end: string }>} */
  const units = [];
  for (const slot of slots) {
    for (let m = hhmmToMinutes(slot.start); m < hhmmToMinutes(slot.end); m += stepMinutes) {
      units.push({ start: minutesToHhmm(m), end: minutesToHhmm(m + stepMinutes) });
    }
  }
  return units;
}

/**
 * Counts how many discrete `stepMinutes` (default 30) units a set of intervals
 * spans. Used to enforce the per-day pick limit regardless of how slots are
 * merged into intervals.
 * @param {Array<{ start: string, end: string }>} slots
 * @param {number} [stepMinutes]
 * @returns {number}
 */
export function countUnits(slots, stepMinutes = 30) {
  let total = 0;
  for (const slot of slots) {
    total += (hhmmToMinutes(slot.end) - hhmmToMinutes(slot.start)) / stepMinutes;
  }
  return total;
}

/**
 * Formats a slot/interval as "HH:MM–HH:MM".
 * @param {{ start: string, end: string }} slot
 * @returns {string}
 */
export function formatSlot(slot) {
  return `${slot.start}–${slot.end}`;
}
