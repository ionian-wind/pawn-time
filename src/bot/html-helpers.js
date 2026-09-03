/**
 * Extracts plain text from an HTML string by stripping all tags and decoding
 * common HTML entities. Adjacent text nodes are joined with a space separator
 * to match the behavior of the former `richTexts` helper.
 * @param {string} html - the HTML string to strip
 * @returns {string} the plain-text content with tags removed
 */
export function htmlTexts(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&\u2713;/g, '\u2713')
    .replace(/&\u2717;/g, '\u2717')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts interactive table cells from an HTML string. Each `<td button="...">`
 * attribute becomes a `{ text, label, callback_data }` object where `label` is
 * the cell's text content (stripped of inner tags) and `text` is an alias of it
 * for object-style compatibility.
 * @param {string} html - the HTML string to scan
 * @returns {Array<{ text: string, label: string, callback_data: string }>} the interactive cells
 */
export function htmlButtons(html) {
  const result = [];
  const re = /<td\s[^>]*button="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const callback_data = match[1];
    const label = match[2].replace(/<[^>]+>/g, '').trim();
    result.push({ text: label, label, callback_data });
  }
  return result;
}
