import { DraftRepository } from './draft.repository.js';
import { PollService } from '../poll/poll.service.js';
import { config } from '../../config/index.js';
import { mergeSlots, expandSlots, countUnits } from './draft-slot.js';

/**
 * Business logic for managing scheduling drafts.
 *
 * A draft is author-owned and invisible to everyone else until it is published
 * into a real poll. Drafts are the building blocks used by the Telegram bot's
 * `/new` flow.
 */
export class DraftService {
  /**
   * Creates a new draft for the given author.
   * @param {import('./draft.entity.js').CreateDraftInput} input
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static createDraft(input) {
    return DraftRepository.create(input);
  }

  /**
   * Returns a draft owned by the author, or null if not found / not owned.
   * @param {string} id
   * @param {string} authorUserId
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static getDraft(id, authorUserId) {
    return DraftRepository.findByAuthorAndId(id, authorUserId);
  }

  /**
   * Lists the author's drafts.
   * @param {string} authorUserId
   * @returns {Array<import('./draft.entity.js').Draft>}
   */
  static listDrafts(authorUserId) {
    return DraftRepository.findByAuthor(authorUserId);
  }

  /**
   * Sets the draft's title. Custom input composes of it.
   * @param {string} id
   * @param {string} authorUserId
   * @param {string} title
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static setTitle(id, authorUserId, title) {
    const draft = this.getDraft(id, authorUserId);
    if (!draft) return null;
    return DraftRepository.update(id, { title: title.trim() });
  }

  /**
   * Adds a day to the draft's selection. Adding beyond `maxDays` (defaults to
   * the configured `config.maxScheduleDays`) is refused: the draft is returned
   * unchanged.
   * @param {string} id
   * @param {string} authorUserId
   * @param {string} date - ISO date (YYYY-MM-DD)
   * @param {number} [maxDays]
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static addDate(id, authorUserId, date, maxDays = config.maxScheduleDays) {
    const draft = this.getDraft(id, authorUserId);
    if (!draft) return null;
    const selectedDates = new Set(draft.selectedDates);
    if (!selectedDates.has(date) && selectedDates.size >= maxDays) return draft;
    selectedDates.add(date);
    return DraftRepository.update(id, {
      selectedDates: [...selectedDates].sort(),
    });
  }

  /**
   * Removes a day from the draft's selection.
   * @param {string} id
   * @param {string} authorUserId
   * @param {string} date - ISO date (YYYY-MM-DD)
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static removeDate(id, authorUserId, date) {
    const draft = this.getDraft(id, authorUserId);
    if (!draft) return null;
    return DraftRepository.update(id, {
      selectedDates: draft.selectedDates.filter((d) => d !== date),
      timeSlots: draft.timeSlots.filter((slot) => slot.date !== date),
    });
  }

  /**
   * Toggles a day on/off in the draft's selection.
   * @param {string} id
   * @param {string} authorUserId
   * @param {string} date - ISO date (YYYY-MM-DD)
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static toggleDate(id, authorUserId, date) {
    const draft = this.getDraft(id, authorUserId);
    if (!draft) return null;
    return draft.selectedDates.includes(date)
      ? this.removeDate(id, authorUserId, date)
      : this.addDate(id, authorUserId, date);
  }

  /**
   * Clears all selected days and time slots.
   * @param {string} id
   * @param {string} authorUserId
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static resetDates(id, authorUserId) {
    const draft = this.getDraft(id, authorUserId);
    if (!draft) return null;
    return DraftRepository.update(id, { selectedDates: [], timeSlots: [] });
  }

  /**
   * Toggles a 30-minute time slot for a date on/off. Selected slots are stored
   * as merged intervals: adding a slot coalesces it with any adjacent selected
   * slot, and removing a slot can split an interval. Adding beyond `maxPerDay`
   * (defaults to the configured `config.maxSlotsPerDay`) discrete 30-minute
   * units for a single date is refused: the draft is returned unchanged.
   * @param {string} id
   * @param {string} authorUserId
   * @param {import('./draft.entity.js').DraftTimeSlot} slot
   * @param {number} [maxPerDay]
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static toggleTimeSlot(id, authorUserId, slot, maxPerDay = config.maxSlotsPerDay) {
    const draft = this.getDraft(id, authorUserId);
    if (!draft) return null;

    const otherDates = draft.timeSlots.filter((s) => s.date !== slot.date);
    const units = expandSlots(draft.timeSlots.filter((s) => s.date === slot.date));

    const hasUnit = units.some((u) => u.start === slot.start && u.end === slot.end);
    if (!hasUnit && countUnits([slot]) + units.length > maxPerDay) return draft;

    const nextUnits = hasUnit
      ? units.filter((u) => !(u.start === slot.start && u.end === slot.end))
      : [...units, slot];

    const mergedForDate = mergeSlots(nextUnits);
    const timeSlots = [...otherDates, ...mergedForDate.map((m) => ({ date: slot.date, ...m }))];

    return DraftRepository.update(id, { timeSlots });
  }

  /**
   * Clears all time slots for a given date.
   * @param {string} id
   * @param {string} authorUserId
   * @param {string} date - ISO date (YYYY-MM-DD)
   * @returns {import('./draft.entity.js').Draft | null}
   */
  static resetTimeSlotsForDate(id, authorUserId, date) {
    const draft = this.getDraft(id, authorUserId);
    if (!draft) return null;
    return DraftRepository.update(id, {
      timeSlots: draft.timeSlots.filter((slot) => slot.date !== date),
    });
  }

  /**
   * Publishes a draft as a real poll. Every selected 30-minute slot becomes a
   * poll option (a datetime poll). The draft becomes just-building until it has
   * a title and at least one slot.
   * @param {string} id
   * @param {string} authorUserId
   * @returns {import('../poll/poll.entity.js').PollWithStats | null}
   */
  static publishDraft(id, authorUserId) {
    const draft = this.getDraft(id, authorUserId);
    if (!draft) return null;
    if (!draft.title) return null;
    if (draft.timeSlots.length === 0) return null;

    const options = draft.timeSlots.map((slot) => ({
      date: slot.date,
      startTime: slot.start,
      endTime: slot.end,
    }));

    return PollService.createPoll(
      {
        title: draft.title,
        pollType: draft.pollType || 'datetime',
      },
      options,
    );
  }

  /**
   * Deletes a draft owned by the author.
   * @param {string} id
   * @param {string} authorUserId
   * @returns {boolean}
   */
  static deleteDraft(id, authorUserId) {
    const draft = this.getDraft(id, authorUserId);
    if (!draft) return false;
    return DraftRepository.delete(id);
  }

  /**
   * Deletes every draft owned by the author.
   * @param {string} authorUserId
   * @returns {number} the number of removed drafts
   */
  static deleteAllDrafts(authorUserId) {
    return DraftRepository.deleteByAuthor(authorUserId);
  }
}
