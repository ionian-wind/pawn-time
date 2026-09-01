import { getTranslator } from './i18n.js';

/**
 * Telegram slash-command menu entries registered at bot startup. The `command`
 * field intentionally omits the leading slash (Telegram requirement).
 *
 * Both commands are marked `is_ephemeral` so that, in group chats, the command
 * message a user sends is invisible to everyone but the author (draft titles in
 * `/new <title>` stay private).
 * @param {string} locale
 * @returns {Array<{ command: string, description: string, is_ephemeral: boolean }>}
 */
export function buildCommands(locale = 'en') {
  const t = getTranslator(locale);
  return [
    { command: 'new', description: t('cmdNew'), is_ephemeral: true },
    { command: 'drafts', description: t('cmdDrafts'), is_ephemeral: true },
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
