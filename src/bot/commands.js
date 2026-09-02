import { getTranslator } from './i18n.js';

/**
 * Telegram slash-command menu entries registered at bot startup. The `command`
 * field intentionally omits the leading slash (Telegram requirement).
 * @param {string} locale
 * @returns {Array<{ command: string, description: string }>}
 */
export function buildCommands(locale = 'en') {
  const t = getTranslator(locale);
  return [
    { command: 'new', description: t('cmdNew') },
    { command: 'drafts', description: t('cmdDrafts') },
  ];
}

/**
 * Registers the bot's slash-command menu via setMyCommands. Without
 * `languageCode` the default (English) menu is registered; passing a language
 * registers the localized menu for that language.
 * @param {import('node-telegram-bot-api').Bot} bot
 * @param {string} [languageCode]
 * @returns {Promise<object>} the params that were sent
 */
export async function registerBotCommands(bot, languageCode) {
  const params = languageCode
    ? { commands: buildCommands(languageCode), language_code: languageCode }
    : { commands: buildCommands() };
  await bot.api.setMyCommands(params);
  return params;
}
