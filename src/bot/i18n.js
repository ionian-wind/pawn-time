/**
 * Small message catalog for the bot. Only en and ru are shipped for now; any
 * unknown or missing locale falls back to English.
 */

/** @type {Record<string, Record<string, string>>} */
const messages = {
  en: {
    usage: 'Usage: /new <title> — for example: /new Team sync',
    pickDays: 'pick one or more days',
    selected: 'Selected:',
    none: 'none',
    untitled: 'untitled',
    noDays: 'No days selected yet.',
    pickSlots: 'pick your free 30-minute slots',
    ok: 'OK',
    back: 'Back',
    reset: 'Reset',
    isLive: 'is live',
    share: 'Share it — everyone can vote <b>Yes</b> / <b>Maybe</b> / <b>No</b>.',
    draftCancelled: 'Draft cancelled.',
  },
  ru: {
    usage: 'Использование: /new <название> — например: /new Командный созвон',
    pickDays: 'выберите один или несколько дней',
    selected: 'Выбрано:',
    none: 'нет',
    untitled: 'без названия',
    noDays: 'Дни пока не выбраны.',
    pickSlots: 'выберите свободные 30-минутные слоты',
    ok: 'ОК',
    back: 'Назад',
    reset: 'Сброс',
    isLive: 'опубликован',
    share: 'Поделитесь — каждый сможет проголосовать <b>Да</b> / <b>Может быть</b> / <b>Нет</b>.',
    draftCancelled: 'Черновик отменён.',
  },
};

/** @type {Array<string>} */
export const SUPPORTED_LOCALES = ['en', 'ru'];

/**
 * Normalizes a raw language code (e.g. "ru-RU") to one of the supported
 * locales, falling back to "en".
 * @param {string | undefined} locale
 * @returns {string}
 */
export function normalizeLocale(locale) {
  if (!locale) return 'en';
  const base = locale.split('-')[0].toLowerCase();
  return SUPPORTED_LOCALES.includes(base) ? base : 'en';
}

/**
 * Returns a translate function for the given locale. `t(key, vars)` looks up a
 * message and substitutes `{name}` placeholders with values from `vars`.
 * @param {string} [locale]
 * @returns {(key: string, vars?: Record<string, string | number>) => string}
 */
export function getTranslator(locale) {
  const lang = normalizeLocale(locale);
  const table = { ...messages.en, ...messages[lang] };

  return (key, vars = {}) => {
    const template = table[key] ?? messages.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`
    );
  };
}
